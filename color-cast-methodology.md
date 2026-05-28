# 图像偏色检测与校准 — 评估方法论

> 配套脚本: `color_cast_detector.py` (检测) / `color_cast_calibrator.py` (校准)
> 依赖: opencv-python, numpy, matplotlib

---

## 一、五维交叉验证体系

```
                    ┌─────────────────┐
                    │    原始图像       │
                    └───────┬─────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
      ┌──────────┐   ┌──────────┐   ┌──────────┐
      │ 肤色 HSV  │   │ 亮度 L*   │   │ Lab a/b  │
      │ 掩码提取  │   │ 分区切分  │   │ 全局统计  │
      └────┬─────┘   └────┬─────┘   └────┬─────┘
           │              │              │
           ▼              ▼              ▼
    肤色独立分析    区域峰值偏离    AB等效圆法 CCC
    (vs 全图 Δ)    (peak_spread)   (Dσ 系数)
           │              │              │
           └──────────────┼──────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │  色诱导模型   │
                   │  (CIECAM02)  │
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
                   │  PCI 感知指数 │
                   │  (人眼加权)  │
                   └──────────────┘
```

### 1.1 亮度分区 + 通道峰值偏离度 (peak_spread)

将画面按 L* 百分位切为三区：
- 阴影: 5% 分位
- 中间调: 40-60% 分位
- 高光: 95% 分位

每区独立建 R/G/B 直方图取峰值，计算峰值间距：

```
peak_spread = max(R_peak, G_peak, B_peak) - min(R_peak, G_peak, B_peak)
```

阈值:
| peak_spread | 判定 |
|-------------|------|
| ≤ 5  | 中性（白平衡准确） |
| ≤ 12 | 轻微偏色 |
| ≤ 25 | 明显偏色 |
| > 25 | 严重偏色 |

核心创新: 比全局均值更不受画面内容干扰。高光区峰值偏离是白平衡问题的最直接证据。

### 1.2 人眼感知偏色指数 (PCI)

CIEDE2000 色差到中性轴，加入人眼非线性加权：
- 红绿轴 ×1.8 感知权重（人眼对 a* 更敏感）
- Weber-Fechner 亮度压缩（暗部偏色被掩盖）
- 同时对比增益（相邻区域色差放大感知）

| PCI | 含义 |
|-----|------|
| < 2 | 无法察觉 |
| < 4 | 训练者才能察觉 |
| < 8 | 普通人可察觉 |
| < 15 | 明显偏色 |
| ≥ 15 | 观感不适 |

### 1.3 AB-Chromaticity 等效圆法 (CCC)

文献: ZTE Communications 2013, "An Improved Color Cast Detection Method Based on an AB-Chromaticity Histogram"

原理: 在 CIELAB 的 a-b 平面建等效圆：
```
μ = √(μa² + μb²)        等效圆中心距原点
σ = √(σa² + σb²)        等效圆半径
CCC = Dσ = (μ - σ) / σ  偏色系数
```

| Dσ | 判定 |
|----|------|
| ≤ 0 | 无色偏 |
| > 0.6 | 极轻微 |
| > 1.5 | 明显偏色 |
| > 3.0 | 严重偏色 |

CCC 判断"统计可靠性"，PCI 判断"感知严重度"——两者互补。

### 1.4 CCC vs PCI 互补矩阵

|         | CCC 低 (Dσ<0.6)      | CCC 高 (Dσ>1.5)      |
|---------|----------------------|----------------------|
| **PCI 低** | ✅ 正常图像           | 统计偏色但人眼不敏感 |
| **PCI 高** | 感知偏色但统计不可靠   | 🔴 确认偏色故障      |

### 1.5 色诱导 / 同时对比 (Chromatic Induction)

原理: 两个相邻的不同颜色区域会互相增强对方的对立（补色）感觉。

公式 (CIECAM02 衍生):
```
a'_perceived = a_center − k × a_surround
b'_perceived = b_center − k × b_surround
```

k 值:
- CIECAM02 Nc = 0.22（平均观看环境）
- 亮环境: 0.15
- 暗环境/投影: 0.35

方向规则:

| 周围颜色 | 中心被推向 | 实例 |
|---------|-----------|------|
| 冷/绿/蓝 (a*<0, b*<0) | 暖/红/黄 | 冷灰背景→肤色显暖 |
| 暖/红/黄 (a*>0, b*>0) | 冷/绿/蓝 | 黄调婚纱→白纱显青 |

### 1.6 肤色独立分析

HSV 肤色掩码 (H=0-25, S=10-150, V=50-255)，单独分析肤色区域的 Lab/RGB/直方图，与全图对比 Δ，排除背景对肤色的干扰。

---

## 二、判定流程

```
图像输入
  │
  ├─ peak_spread > 15? ──是──→ 高光/阴影分别检查
  │       │                        │
  │       否                       ├─ 高光 spread > 15 → 白平衡偏色
  │       │                        └─ 阴影 spread > 15 → 暗部染色
  │       ▼
  ├─ CCC Dσ > 0? ────是──→ 偏色存在（统计可靠）
  │       │                   │
  │       否                  ├─ Dσ > 1.5 → 显著偏色
  │       │                   └─ Dσ > 3.0 → 严重偏色
  │       ▼
  ├─ PCI > 4? ─────是──→ 人眼可感知
  │       │                │
  │       否               ├─ PCI > 8 → 普通人可察觉
  │       │                └─ PCI > 15 → 观感不适
  │       ▼
  └─ 诱导 > 2? ────是──→ 同时对比放大偏色
          │
          否 → ✅ 无可感知偏色
```

**四维同时报警 → 确认偏色故障。单维报警 → 可能是后期风格。**

---

## 三、人眼非线性感知权重

| 色相区域 | 相对敏感度 | 说明 |
|---------|-----------|------|
| 红-绿轴 (a*) | 1.8× | 人类对红绿差异最敏感 |
| 黄-蓝轴 (b*) | 1.0× | 基准 |
| 暗部 (L*<30) | 0.3-0.5× | Weber 压缩 |
| 亮部 (L*>70) | 1.0× | 正常感知 |

---

## 四、学术界参考方法

### 4.1 Gray World（灰度世界）

假设自然界场景 RGB 均值为灰色 (R̄=Ḡ=B̄)，计算增益后校正。

局限: 大色块场景（蓝天、草地、红花）失效。

### 4.2 White Patch / Perfect Reflector（白斑法）

假设最亮像素应为纯白色。进阶版取 top N% 均值，对噪声更鲁棒。

### 4.3 CIEDE2000 (ΔE00)

ISO/CIE 11664-6:2014 标准。相比 ΔE76 加入色相角、彩度、亮度非线性补偿，对低彩度（灰色）区域的色差更敏感——正是检测偏色的优势。

### 4.4 本工具的独创：亮度分区峰值偏离

现有方法不按亮度分层。本工具按 L* 百分位切阴影/中间调/高光，每区独立建 RGB 直方图取峰值计算间距。峰值比均值不受离群像素干扰，亮度分区排除内容本身色彩构成的干扰。

---

## 五、校准模式决策树

```
检测到偏色 → 是刻意后期吗？（split-tone detected?）
  ├─ 是 → preserve-split-tone 或 不校准
  └─ 否 → 是户外蓝景伪偏色？（蓝天/大海/蓝衣 + 肤色正常 + CCC 负）
       ├─ 是 → 不校准 — 蓝来自场景内容，白平衡正确
       └─ 否 → 主体是什么？
            ├─ 彩色物体（蔬菜、花卉、食物）→ midtones-only
            ├─ 人像/婚纱（整体干净，仅肤色偏暖）→ skin-only
            ├─ 白色物体偏黄（白纱、白墙、白T恤）→ highlights-only
            │    └─ 先用亮度分布分析确定最佳阈值
            └─ 均匀白平衡偏移 → global
```

### 六种模式速查

| 模式 | 标志 | 原理 | 适用场景 |
|------|------|------|----------|
| Global | 默认 | 全图统一 Lab 通道偏移 | 整体白平衡偏移 |
| Midtones-only | `--midtones-only` | 仅校准中间调(30-70%亮度) | 彩色主体（绿菜、花） |
| Skin-priority | `--skin-only` | 肤色区域100%，背景30% | 人像肤色偏黄/绿；婚纱 |
| Preserve split-tone | `--preserve-split-tone` | 中间调100%，阴影/高光30% | 保留胶片分离色调风格 |
| Highlights-only | `--highlights-only` | 低饱和(Sat<p25)识别白纱，L*阈值可调 | 白纱/白墙等白色物体去黄 |
| Highlights-pct | `--highlight-pct N` | 亮度分位阈值（默认55） | 精确调控白织物覆盖范围 |

---

## 六、参数溯源

### 检测参数

| 参数 | 取值 | 来源 |
|------|------|------|
| 色诱导系数 k | 0.22 | CIECAM02 Nc 默认 |
| 红绿感知权重 | 1.8× | CIE 标准观察者 |
| Weber 暗部分数 | 0.06 | Weber-Fechner 定律 |
| Weber 亮部分数 | 0.02 | Weber-Fechner 定律 |
| CCC Dσ 阈值 | 0/0.6/1.5/3.0 | ZTE 论文 |
| 肤色 HSV | H=0-25 S=10-150 | 亚洲肤色经验 |

### 校准参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| strength | 0.8 | 不设 1.0 是为保留部分原始氛围 |
| 肤色 weight | 0.7-1.0 | 肤色区域 full strength，背景 30% |
| split-tone 阴影/高光 | 0.3 | 阴影和高光仅 30% 校准强度 |
| highlights b* 向强度 | 35%（代码内置） | mask 已筛选目标像素，自动弱化 |

---

## 七、典型案例

### Case 1: 户外人像 (film simulation)

检测: a*=-5.0, b*=+6.4, |dE|=8.1 — split-tone detected
判定: 刻意做旧后期，**不校准**。

| 模式 | Before |dE| | After |dE| | 削减率 |
|------|------------|-----------|-----------|
| global | 8.1 | 1.4 | 82% |
| midtones-only | 8.1 | 5.4 | 34% |
| skin-only | 8.1 | 6.0 | 26% |
| preserve-split-tone | 8.1 | 6.5 | 20% |

### Case 2: 蒜苔室内照（暖光 + 绿色主体）

检测: a*=+1.3, b*=+16.1, |dE|=16.1 — heavy yellow
判定: 暖光 + 绿色主体，**midtones-only 推荐**（用户选择此模式）。

| 模式 | Before |dE| | After |dE| | 削减率 |
|------|------------|-----------|-----------|
| global | 16.1 | 3.4 | 79% |
| **midtones-only** ✓ | 16.1 | 10.4 | 36% |
| skin-only | 16.1 | 9.8 | 39% |

### Case 3: 棚拍婚纱

检测: a*=-0.3, b*=+4.2, |dE|=4.2 — mild yellow, skin PCI=10.2
判定: 整体干净，仅肤色偏暖，**skin-only 推荐**。

---

## 八、重要教训

1. **Lab 通道偏移方向**: `+=` 补偿量（不是 `-=`）——偏移量已取反，加回去才是中和
2. **全局平均值掩盖局部偏色**: 单人婚纱全图 a*=-0.4 看似正常，但高光 peak_spread=21
3. **CCC 和 PCI 互补**: 高 CCC 低 PCI = 统计偏但人不敏感；低 CCC 高 PCI = 分布散但感知扎眼
4. **彩色主体选 midtones-only**: 全局校准会洗掉自然色（蒜苔图 global 削 79% 但用户选 midtones-only 36%）
5. **白纱偏黄 ≠ 白纱本身偏色（感知错觉）**: 纯白织物 b*≈0 很中性，黄色偏来自半透明过渡区（纱+肤叠加）和暖光灯散射。先分析亮度分布
6. **户外蓝景是伪偏色——不要校准**: 晴天海岸/蓝天白云中肤色正常 + CCC 负 = 白平衡正确。global 模式会杀死自然蓝天和大海
7. **Highlights-only 白纱延伸到中间调**: 婚纱案例白纱 L* 中位数=201（画面 p60），用 p80 仅覆盖 5.2%。`--highlight-pct` 默认应为 55
8. **不要用 scipy**: `gaussian_filter` 用 `cv2.GaussianBlur` 替代（免依赖）
9. **read_file + write_file 陷阱**: `read_file()` 返回带行号前缀的内容，直接用 `write_file()` 写回会污染文件。改脚本用 `patch` 工具

---

## 九、用法速查

```bash
# ★ 完整检测（五维 + 3×3 图表）
/usr/bin/python3 color_cast_detector.py \
    --skin --regions --perceptual --ccc --induction \
    --chart /tmp/report.png photo.jpg

# 自动校准（检测 + 全局补偿）
/usr/bin/python3 color_cast_calibrator.py photo.jpg -o calibrated.jpg

# 只校中间调（彩色主体）
/usr/bin/python3 color_cast_calibrator.py --midtones-only photo.jpg -o out.jpg

# 肤色优先（人像/婚纱）
/usr/bin/python3 color_cast_calibrator.py --skin-only photo.jpg -o out.jpg

# 高光去黄（白纱/白墙）
/usr/bin/python3 color_cast_calibrator.py --highlights-only photo.jpg -o out.jpg

# 保留分离色调
/usr/bin/python3 color_cast_calibrator.py --preserve-split-tone photo.jpg -o out.jpg

# 并排对比
/usr/bin/python3 color_cast_calibrator.py --compare photo.jpg -o compare.jpg

# 调整强度（默认 0.8）
/usr/bin/python3 color_cast_calibrator.py --strength 0.5 photo.jpg -o out.jpg
```

---

## 参考文献

1. Bai, Yang et al. "An Improved Image Color Cast Detection Algorithm." Semantic Scholar.
2. "Efficient Framework for Real-Time Color Cast Correction." IEEE Access.
3. "Novel approach to color cast detection and removal in digital images." ResearchGate.
4. "Modified grey world method to detect and restore colour cast images." IET Image Processing.
5. Luo, Cui, Rigg. "The development of the CIE 2000 colour-difference formula: CIEDE2000." Color Research & Application, 2001.
6. Fairchild, M.D. "Color Appearance Models" (CIECAM02). Wiley, 2013.
7. Chevreul, M.E. "The Principles of Harmony and Contrast of Colours." 1839.
