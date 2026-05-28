# Photo Calibrator Agents Guide

本文档是本项目后续开发 agent 的执行手册。目标不是把现有脚本简单套 GUI，而是逐步重构为跨平台、可扩展、面向摄影工作流的桌面级色彩分析与校准应用。

## 0. 当前状态

仓库已经从早期三脚本形态进入了可运行 MVP。历史核心文件仍可作为算法来源参考：

- `color_cast_detector.py`: 偏色检测、肤色/亮度分区、CCC、PCI、诱导效应、Matplotlib 报告图。
- `color_cast_calibrator.py`: 基于 Lab a*/b* 偏移的全局/中间调/肤色/高光/保留分离色调校准。
- `color-cast-methodology.md`: 现有算法方法论。

当前主要实现位于：

- `src/photo_calibrator/core/`: 图像模型、偏色分析、校准算法、accelerator 抽象。
- `src/photo_calibrator/backend/simple_server.py`: 本地 HTTP 服务、预览缓存、内存分析缓存、批处理 API。
- `web/`: 轻量 Web UI，支持文件/文件夹导入、TIFF/RAW 预览、图表展示、session 调参。
- `tests/`: Python 单元测试和 Playwright UI 测试。

已实现的性能/加速基础：

- CPU 多线程：OpenCV optimized + 线程数配置；本地路径批处理 API `/api/calibrate-paths` 和上传批处理 API `/api/calibrate-batch` 都使用 worker 并行，并保持输入顺序返回结果。
- 缓存：本地预览 JPEG 缓存、内存 `PreparedImage`/输入分析/静态图表缓存；同一 `cache_key` 有 per-key lock，重复上传/重复路径并行处理只构建一次分析结果；前端通过 `session_id` 调参，滑杆 `input` 防抖调用 `/api/calibrate-session`，不重解码。
- Accelerator 后端：`cpu-opencv`、`opencl-umat`、可选 `torch-cuda`/`torch-mps`/`metal-mps`。没有 GPU 或依赖时必须自动 fallback 到 CPU。
- 高收益算子接口：resize、RGB/Lab、Lab/RGB、曲线 LUT、矩阵、直方图、3D LUT 已进入 accelerator 调用面。OpenCL 覆盖 resize/RGB-Lab/Lab-RGB/LUT/matrix/histogram；Torch 覆盖 resize/RGB-Lab/Lab-RGB/曲线 LUT/matrix/3D LUT；`auto` 在 Torch GPU 和 OpenCL 同时可用时可使用 hybrid 后端。
- Accelerator 验证：
  - API: `GET /api/accelerator-benchmark?backend=auto&image_side=256&lut_size=17&iterations=3`
  - CLI: `python -m photo_calibrator.backend.accelerator_benchmark --backend auto`
  - GPU 3D LUT 硬门禁: `python -m photo_calibrator.backend.accelerator_benchmark --backend torch --require-accelerated 3d-lut`
  - 安装入口: `pip install -e ".[gpu]"` 或 `pip install -e ".[all]"`。

主要限制：

- 当前核心仍主要是 8-bit 预览管线；RAW、16-bit TIFF、EXR/HDR 和高质量导出还需要完整 float/色彩管理管线。
- 轻量 HTTP 服务是 MVP，不是最终 FastAPI/IPC 架构。
- 当前校准以 Lab 通道平移、RGB 曲线、矩阵、3D LUT 预览为主，缺少 ICC/OCIO/LUT 导出管线、线性光处理、软打样和非破坏编辑模型。
- GPU 可用性取决于运行环境。开发机若无 OpenCL/CUDA/MPS，只能验证 CPU fallback 和 fake torch 逻辑，不能宣称完成实机 GPU 性能验证。
- 现有肤色/高光掩码是启发式规则，适合 MVP，但不能作为专业自动裁切、胶片翻拍、复杂主体识别的最终方案。
- 中文/英文输出有部分乱码和语义残缺，重构时应重新整理用户可见文案。

## 1. 产品目标

第一阶段交付一个本地桌面应用，支持导入常见照片、RAW、TIFF、HDR/EXR，进行偏色分析、可视化校准、导出校准配置和高质量图像。平台优先级为 Linux + macOS；暂不要求 Windows 兼容。

必须支持：

- 现代化 UI，原图/校准图所见即所得对比，直方图、Lab 向量、分区指标、肤色/灰卡/高光遮罩清晰可见。
- RAW、TIFF、HDR/EXR 输入，尽量保留高位深和色彩空间信息。
- 导出校准文件：至少支持 sidecar JSON、3D LUT `.cube`、ICC/OCIO 工作流预留接口。
- 导出图像：JPEG、PNG、16-bit TIFF、OpenEXR/HDR；导出必须明确色彩空间、位深、压缩和元数据策略。
- 插件系统：导入器、分析器、校准器、导出器、AI 评估器都应能插件化。
- 胶片翻拍图像自动水平校准和裁切。
- 可接入多模态 AI 模型对校准结果做评价，但 AI 只作评估/建议，不直接覆盖确定性校准结果。

## 2. 技术栈结论

推荐主线分两步走：

1. 后端/核心库：`Python 3.12+ + FastAPI or local IPC + NumPy/OpenCV + rawpy/LibRaw + OpenImageIO + OpenColorIO + pydantic + pluggy`。
2. 桌面 UI：`Electron + React/Vite/TypeScript + Playwright`，通过 HTTP/WebSocket/stdio IPC 调用 Python 后端。

理由：

- 当前算法资产是 Python/NumPy/OpenCV，继续用 Python 能最快复用并重构。
- UI 优先选择 Web 技术栈，方便用 Playwright 做端到端自动化、截图回归和交互验证。Electron 官方定位是用 JavaScript、HTML、CSS 构建桌面应用，并内置 Chromium/Node，渲染目标更稳定：https://www.electronjs.org/docs/latest/
- Playwright 对 Electron 有官方自动化入口，可直接驱动 Electron app 做 E2E 测试，适合本项目大量图像预览、参数滑杆、导出对话框的回归验证：https://playwright.dev/docs/api/class-electron
- `rawpy` 是 LibRaw 的 Python wrapper，用于 RAW 解码；PyPI 当前说明为 "RAW image processing for Python, a wrapper for libraw"：https://pypi.org/project/rawpy/
- LibRaw 专门处理相机 RAW，并持续维护相机支持列表；RAW 支持不要自研：https://www.libraw.org/supported-cameras
- OpenImageIO 提供专业图像读写和格式插件，覆盖 TIFF、OpenEXR、HDR/RGBE、多种 RAW、常见位图格式，适合作为中长期图像 I/O 层：https://sites.google.com/site/openimageio/home
- OpenColorIO 是影视/VFX 常用色彩管理框架，支持 ACES 和 LUT 格式无关的工作流，适合作为色彩配置、显示变换、LUT 导出的基础：https://github.com/AcademySoftwareFoundation/OpenColorIO

备选但暂不推荐：

- `Tauri + Rust + Web UI`: 适合轻量现代外壳。Tauri 支持任意前端框架，但 macOS 使用 WKWebView、Linux 使用 WebKitGTK，前端渲染一致性和 Playwright/E2E 便利性不如 Electron。可作为后期减包体方案关注：https://tauri.app/
- `Neutralinojs`: 更轻量，但生态、复杂 IPC、专业图像应用案例和测试链路不如 Electron 成熟，可作为实验性备选：https://neutralino.js.org/
- `Qt/PySide6/C++ Qt`: 暂不采用。Qt 生态成熟，但授权、分发和后续 UI 自动化接入不是当前最优解；除非后续明确许可证策略并放弃 Web UI 路线，否则不作为主线。

## 3. 可行性判断

总体可行，但要按专业图像应用的边界推进。

高可行：

- 桌面 UI、项目面板、预览、前后对比、参数滑杆、遮罩叠加、直方图和 Lab 图表。
- 复用现有偏色检测与校准逻辑，先抽为纯函数/服务层。
- RAW 基础导入、TIFF/EXR/HDR 读写、JPEG/PNG/16-bit TIFF 导出。
- sidecar JSON、`.cube` LUT、插件 manifest、插件注册表。

中等风险：

- 全链路色彩准确性。必须建立明确的内部工作空间，例如 scene-linear RGB float32 或 ACEScg，并对显示变换和导出变换做测试。
- OpenImageIO/OCIO 和 Python 后端在 Linux/macOS 的打包。Electron 只负责 UI 外壳，Python runtime、native wheels、动态库和插件路径仍需要早做 CI 打包验证。
- 高分辨率 RAW 预览性能。需要金字塔缓存、后台任务、缩略图和预览分辨率分离。
- Electron 包体和内存占用高于系统 WebView 方案；但本项目更重视渲染一致性、Playwright 可测性和前端生态，MVP 接受该代价。

高风险/不能承诺一步到位：

- "自动校准到专业审美正确"。无灰卡/色卡/目标参考时，算法只能做统计和感知建议，不能保证还原真实光源。
- "所有 RAW 相机格式全支持"。RAW 支持取决于 LibRaw/OpenImageIO 版本和相机新旧。
- 多模态 AI 评估的客观性。AI 可辅助发现偏色、过曝、裁切错误、胶片边框残留，但不能替代确定性的色彩管理和数值评估。

## 4. 架构原则

必须把工程分为六层，禁止 UI 直接调用脚本式函数并打印结果。

1. `core`
   - 纯算法层：色彩统计、偏色检测、遮罩、胶片边框检测、几何校正、校准曲线/LUT 生成。
   - 输入输出使用 typed ndarray/image model，不读写文件，不操作任何 UI 框架。

2. `io`
   - RAW/TIFF/EXR/HDR/JPEG/PNG 导入导出。
   - 负责元数据、ICC profile、EXIF/XMP、位深、色彩空间标记。
   - 目标内部格式：`ImageBuffer(data: np.ndarray, color_space, bit_depth, metadata, orientation)`。

3. `pipeline`
   - 非破坏处理图：输入图像 + 一组操作节点 + 参数。
   - 负责预览渲染、缓存、撤销/重做、批处理。

4. `backend`
   - 本地服务/API 层：FastAPI HTTP/WebSocket 或 stdio JSON-RPC。
   - 负责把 `core/io/pipeline/plugins/ai` 暴露给桌面 UI。
   - 不包含前端状态管理，不直接操作 DOM/浏览器。

5. `frontend`
   - React/Vite/TypeScript Web UI：主窗口、图像视图、工具栏、参数面板、图表面板、导出对话框、插件管理。
   - UI 只调用 backend API，不包含核心算法。
   - 必须可被 Playwright 自动化，关键控件需要稳定 `data-testid`。

6. `plugins`
   - 插件发现、manifest 校验、hook 调用、权限/隔离策略。
   - MVP 可用 Python 插件，后续再增加外部进程插件。

## 5. 推荐目录结构

```text
photo_calibrator/
  pyproject.toml
  AGENTS.md
  src/photo_calibrator/
    __init__.py
    backend/
      main.py
      api.py
      schemas.py
      workers.py
    core/
      image_model.py
      color_metrics.py
      cast_detection.py
      calibration.py
      film_scan.py
      lut.py
    io/
      readers.py
      writers.py
      raw.py
      ocio.py
      metadata.py
    pipeline/
      document.py
      operations.py
      renderer.py
      cache.py
    plugins/
      api.py
      manager.py
      hooks.py
      builtin/
    ai/
      evaluators.py
      prompts.py
      providers.py
  desktop/
    package.json
    electron/
      main.ts
      preload.ts
    src/
      App.tsx
      api/
      components/
      panels/
      charts/
      styles/
    tests/
      e2e/
  tests/
    test_color_metrics.py
    test_calibration.py
    test_film_scan.py
    test_plugin_manager.py
```

## 6. UI 设计方向

主界面采用专业工具布局，而不是营销页：

- 顶部：文件、导入、导出、撤销/重做、缩放、软打样、插件入口。
- 左侧：项目/历史/预设列表。
- 中央：图像预览，可切换单图、左右对比、分割线对比、遮罩叠加。
- 右侧：校准参数，包括强度、模式、白点/灰点、亮度区间、肤色保护、高光保护、分离色调保护。
- 底部或可停靠面板：RGB 直方图、Lab a/b 向量图、CCC 圆、PCI 条形图、区域统计表。

要求：

- 所有滑杆修改必须实时预览，重计算任务放后台线程，UI 不阻塞。
- 图表不再只生成静态 Matplotlib 报告。MVP 前端优先使用 Canvas/WebGL/SVG 图表库，例如 ECharts、Plotly 或自研轻量 Canvas；后端只返回结构化数据和预览图块。
- 图像预览必须有颜色管理。显示用 view transform，导出用 export transform，不要把屏幕显示结果误当作文件数据。
- 用户可见文案统一中文，内部代码/API 使用英文。
- 关键 UI 流程必须有 Playwright E2E：打开图像、拖动校准滑杆、切换对比模式、显示遮罩、导出文件。

## 7. 图像与色彩管线

内部处理建议：

- 解码后转为 float32，范围 `0.0-1.0`。
- RAW 默认走 LibRaw/rawpy 解码，保留相机白平衡、黑白电平、相机矩阵和 EXIF。需要提供 "相机默认"、"自动白平衡"、"手动色温/色调" 选项。
- TIFF/EXR/HDR 优先用 OpenImageIO，读取位深、通道、ICC/色彩空间元数据。
- 所有核心算法禁止默认假设 8-bit sRGB。
- 分析可在预览缩放图上快速计算，但最终导出必须在全分辨率上重放同一参数。
- 输出文件必须明确写入色彩 profile 或标记；无 profile 时在导出 UI 中警告。

最低导出：

- 图像：JPEG 8-bit sRGB、PNG 8/16-bit、TIFF 16-bit、OpenEXR half/float。
- 校准配置：sidecar `.json`，包含输入文件指纹、算法版本、参数、色彩空间、导出配置。
- LUT：`.cube` 3D LUT，初版可只表达全局色彩变换，局部遮罩校准需在 sidecar 中保存，不要伪装成完整 LUT。

## 8. 插件系统

MVP 使用 Python 插件，基于 `pluggy` 或自定义 manifest + entry point。插件目录：

```text
plugins/
  my_plugin/
    plugin.json
    plugin.py
```

`plugin.json` 示例：

```json
{
  "id": "example.ai_evaluator",
  "name": "Example AI Evaluator",
  "version": "0.1.0",
  "api_version": "0.1",
  "hooks": ["ai_evaluator"],
  "permissions": ["network:optional"]
}
```

核心 hooks：

- `image_reader`: 增加输入格式。
- `image_writer`: 增加输出格式。
- `analyzer`: 返回分析指标和可视化数据。
- `calibrator`: 返回可预览、可导出的操作节点。
- `film_scan_detector`: 返回旋转、裁切、边框 mask。
- `ai_evaluator`: 返回自然语言评价、风险提示、建议参数，不直接修改图像。

安全策略：

- 本地 Python 插件默认信任当前用户，不适合安装未知来源插件。
- 有网络、文件批量写入、外部进程调用的插件必须在 UI 中显式显示权限。
- 中长期把不可信插件迁移到外部进程，通过 JSON-RPC/gRPC 通信。

## 9. 胶片翻拍自动水平和裁切

不要从一开始引入重型 ML。先做确定性 CV 管线：

1. 读取预览图并转线性或灰度。
2. 边缘检测：Canny/Sobel。
3. 直线检测：Hough lines 或 LSD。
4. 找最大近似矩形：轮廓、四边形拟合、面积/长宽比/边缘置信度筛选。
5. 估计旋转角和透视变换。
6. 自动裁切并保留可调边距。
7. UI 显示检测框，允许用户拖拽四角。

失败回退：

- 若置信度低，不自动应用，只显示建议框。
- 负片、黑边、白边、相框、胶片齿孔场景都要作为测试样例。
- 胶片翻拍裁切是独立 pipeline operation，不应写死在导入阶段。

## 10. AI 评估接入

AI 模块应设计为 provider-agnostic：

- 输入：低分辨率预览图、校准前后对比图、分析指标 JSON、用户目标，例如 "还原真实白平衡" 或 "保留胶片感"。
- 输出：结构化 JSON，包括 `score`、`issues`、`suggested_adjustments`、`confidence`、`rationale`。
- 禁止 AI 直接返回任意 Python 代码或直接改 pipeline。
- 用户必须能关闭 AI；网络调用不得阻塞本地编辑。
- 隐私：默认不上传原始高分辨率图；上传前需要明确确认。

示例输出 schema：

```json
{
  "score": 0.82,
  "issues": [
    {"type": "white_balance", "severity": "medium", "message": "高光仍略偏黄"}
  ],
  "suggested_adjustments": [
    {"operation": "lab_shift", "params": {"b": -1.5}, "confidence": 0.7}
  ],
  "confidence": 0.76
}
```

## 11. 开发阶段

### Phase 1: 重构脚本为库

目标：无 UI，仅把现有脚本变成可测试模块。

任务：

- 创建 `pyproject.toml` 和 `src/photo_calibrator`。
- 拆分 `color_cast_detector.py` 和 `color_cast_calibrator.py` 到 `core`。
- 建立 `ImageBuffer`、`CastReport`、`CalibrationParams`、`CalibrationResult` 数据结构。
- 移除核心层 `print()` 和 `sys.exit()`，改为返回结构化结果。
- 添加基础单元测试和一组小尺寸合成图测试。

验收：

- `pytest` 通过。
- 旧 CLI 功能用新库重新实现，输出结果与旧脚本在容忍范围内一致。

### Phase 2: 图像 I/O 和色彩管理

目标：支持 RAW、TIFF、EXR/HDR 和高质量导出。

任务：

- 接入 `rawpy` 作为 RAW 初版解码。
- 接入 OpenImageIO 作为 TIFF/EXR/HDR 和通用 I/O 抽象。
- 建立 ICC/OCIO 元数据字段和导出选项。
- 所有核心算法适配 float32 和 16-bit 数据。

验收：

- 能打开 DNG/CR2/NEF/ARW 中至少两类样例、16-bit TIFF、OpenEXR/HDR。
- 能导出 JPEG、PNG、16-bit TIFF。
- 校准前后指标不因 8-bit 截断产生明显错误。

### Phase 3: Backend API + Web UI MVP

目标：先有可调试的本地后端 API，再用 Web UI 做可用的编辑界面。

任务：

- 实现本地 backend API：导入图像、返回预览、返回分析报告、应用校准参数、导出文件。
- 实现 React/Vite/TypeScript 前端：文件导入、预览、参数面板、图表面板。
- 实时预览使用后端 worker 和缓存，前端通过 WebSocket/SSE 或轮询获取任务状态。
- 支持撤销/重做和 sidecar 保存/加载。
- 图表使用前端 Canvas/SVG 图表，不把 Matplotlib 图片作为长期 UI 方案。

验收：

- 后端可独立启动并通过 API smoke test。
- 打开图片、调整参数、查看分析图、导出图片的主流程可完成。
- 预览大图时 UI 不冻结。
- Playwright 能覆盖主流程，并产出桌面/浏览器截图用于回归检查。

### Phase 4: Electron Shell、胶片翻拍与插件系统

目标：扩展性和专业摄影工作流。

任务：

- 用 Electron 包装 Web UI，负责菜单、文件对话框、后端进程生命周期、应用配置目录。
- 实现胶片边框检测、旋转、透视/裁切操作。
- 实现插件 manager、manifest 校验、hook API。
- 内置插件化示例：一个 analyzer，一个 exporter，一个 AI evaluator stub。

验收：

- Linux + macOS 能启动 Electron app，且能自动拉起/关闭本地 Python 后端。
- 插件可以在不改核心代码的情况下注册新 analyzer。
- 胶片翻拍样例能自动给出裁切框和旋转建议，低置信度时不自动破坏图像。
- Playwright 使用 Electron driver 跑通导入、编辑、裁切建议、导出 smoke test。

### Phase 5: AI 评估和打包发布

目标：Linux + macOS 可分发。

任务：

- 实现 AI provider 接口和至少一个可配置 provider。
- 增加隐私确认、请求日志、失败重试。
- 配置 Linux/macOS 打包，验证 Electron、Python runtime、native image I/O 依赖路径。
- 建立最小 CI：lint、test、build smoke test。

验收：

- Linux + macOS 至少能构建出可启动包。
- AI 失败不影响本地图像编辑和导出。

## 12. 代码质量要求

- 新代码必须有类型标注，核心数据结构优先用 `dataclass` 或 `pydantic`。
- 核心层不可依赖 Electron、浏览器、React 或任何 UI 框架。
- 后端 API 必须有稳定 schema；前端不得直接解析 Python 控制台文本。
- 图像处理函数必须声明输入色彩空间、dtype、范围和输出。
- 禁止在核心层 silently clip，除非函数名或参数明确表示会裁剪。
- 任何自动校准都要返回校准前后指标，不能只返回图像。
- 对性能敏感的循环优先 NumPy/OpenCV 向量化；必要时再考虑 numba/Cython/Rust 扩展。
- 用户可见文案集中管理，避免散落在算法函数里。

## 13. 初始依赖建议

`pyproject.toml` 初版可包含：

- Python runtime: `numpy`, `opencv-python`, `pydantic`, `fastapi`, `uvicorn`, `rawpy`, `pillow`, `pluggy`, `platformdirs`.
- Optional image-io: `OpenImageIO`, `OpenColorIO`, `imageio`, `tifffile`.
- Python dev: `pytest`, `ruff`, `mypy`, `httpx`.
- Frontend runtime/dev: `electron`, `vite`, `react`, `typescript`, `@playwright/test`, `eslint`, `prettier`.

注意：OpenImageIO/OpenColorIO 的 Python wheel 和系统动态库在不同平台差异较大。若安装困难，先把接口抽象好，用 `rawpy + tifffile + imageio` 完成 Phase 2 的最小可用版本，再把 OIIO/OCIO 作为专业后端接入。

## 14. 关键决策点

需要用户确认或后续实验的数据：

- 商业闭源还是开源。即使不使用 Qt，Electron、OpenImageIO、OpenColorIO、LibRaw、OpenCV 和插件分发仍需要许可证审计。
- Linux/macOS 的最低系统版本、CPU 架构要求，例如 macOS Intel/Apple Silicon 是否都支持。
- RAW 工作流是否需要相机色彩配置、DCP/ICC、色卡校准，还是先做统计白平衡/偏色校准。
- AI provider 优先接入哪个生态，以及是否允许上传图像到云端。
- UI 是偏 "专业摄影软件" 还是 "轻量校准工具"。这会影响参数暴露深度和默认模式。

在这些决策未确认前，默认按本地优先、开源友好、专业可扩展、最小云依赖推进。

## 15. 多 Agent 并行开发模式

本节是当前阶段最重要的协作规则。多个 agent 可以同时开发，但必须遵守文件所有权和接口契约，避免互相覆盖。

### 15.1 总原则

- 每个 agent 只改自己负责的文件集合。需要跨边界改动时，先在最终汇报中列为 "需要协调"，不要直接改别人的区域。
- 后端 API schema、核心数据模型、前端请求字段属于共享契约。改动前必须先写兼容层或新增字段，不能删除/重命名现有字段。
- 所有新增功能都必须有对应测试；无法在当前环境验证 GPU/RAW/EXR 实机时，要提供 fake/mock 测试和明确 fallback 证明。
- 不要大规模格式化全仓库。只格式化自己改动的文件。
- 不要改 `node_modules/`、`.cache/`、`outputs/`、`test-results/`。
- 不要重启或杀端口，除非当前 agent 的任务明确需要服务验证。重启前在汇报里说明。

### 15.2 当前共享事实

- 可运行后端：`PYTHONPATH=src python3 -m photo_calibrator.backend.simple_server --port 8766 --accelerator auto`
- 可运行 UI：`http://127.0.0.1:8766`
- 必跑 Python 验证：`python3 -m pytest`
- 必跑编译验证：`python3 -m compileall -q src tests`
- UI 相关改动必跑：`npm run test:ui`
- Accelerator 验证：`PYTHONPATH=src python3 -m photo_calibrator.backend.accelerator_benchmark --backend auto --image-side 64 --lut-size 7 --iterations 1`
- 当前 benchmark 操作必须包含 6 项：`resize`、`rgb-lab`、`lab-rgb`、`curve-lut`、`matrix`、`3d-lut`。

### 15.3 Agent A: Accelerator / Performance

目标：继续完善 CPU/GPU 抽象、benchmark、fallback 和性能证明。

只负责：

- `src/photo_calibrator/core/accelerator.py`
- `src/photo_calibrator/backend/accelerator.py`
- `src/photo_calibrator/backend/accelerator_benchmark.py`
- `tests/test_accelerator.py`
- `tests/test_accelerator_benchmark_cli.py`
- 与 benchmark 表格相关的极小 UI 测试调整：`tests/ui/photo_calibrator_ui.spec.js`

可以做：

- 优化 Torch/OpenCL 后端。
- 增加新的 backend capability 字段，但必须向后兼容。
- 增加 benchmark 操作，但要同步 CLI/API/UI 测试。
- 优化 CPU fallback 性能。

不要做：

- 不要改导入/导出格式。
- 不要改主 UI 布局。
- 不要改校准算法的用户参数语义。

验收：

- `python3 -m pytest tests/test_accelerator.py tests/test_accelerator_benchmark_cli.py`
- `PYTHONPATH=src python3 -m photo_calibrator.backend.accelerator_benchmark --backend cpu-opencv --image-side 64 --lut-size 7 --iterations 1`
- 如果改 UI benchmark，再跑 `npm run test:ui`。

### 15.4 Agent B: Image I/O / RAW / TIFF / HDR

目标：把当前 8-bit 预览管线逐步升级为 dtype-aware、可高质量导出的图像 I/O 层。

只负责：

- `src/photo_calibrator/core/image_model.py`
- 新建/修改 `src/photo_calibrator/io/`
- `src/photo_calibrator/backend/simple_server.py` 中 `_decode_*`、`_prepare_*`、`_encode_*` 相关函数
- `tests/test_simple_server_api.py` 中 I/O 相关测试
- 可新增 `tests/test_image_io.py`

可以做：

- 新增 `ImageBuffer` 字段：dtype、range、color_space、icc_profile、metadata、orientation。
- 接入 `tifffile`/`imageio`/`rawpy` 的可选路径。
- 增加 HDR/EXR 探测和明确错误信息。
- 增加 16-bit TIFF/PNG 导出 API 的后端能力，但先不要改前端导出 UI。

不要做：

- 不要改 accelerator 后端实现。
- 不要改前端布局。
- 不要删除当前 data URL/JPEG 预览响应字段。

验收：

- `python3 -m pytest tests/test_simple_server_api.py`
- 新增格式必须有小尺寸合成图或 mock 测试。
- 可选依赖缺失时必须给出清晰错误并保持现有 JPEG/PNG/TIFF 流程可用。

### 15.5 Agent C: Calibration / Film Scan

目标：完善色彩校准算法、胶片翻拍自动水平/裁切、肤色/高光/分区保护。

只负责：

- `src/photo_calibrator/core/calibration.py`
- `src/photo_calibrator/core/cast_detection.py`
- 新建/修改 `src/photo_calibrator/core/film_scan.py`
- `tests/test_calibration.py`
- `tests/test_cast_detection.py`
- 可新增 `tests/test_film_scan.py`

可以做：

- 改进 RGB 曲线、矩阵、3D LUT、film mode。
- 新增胶片边框检测、旋转角估计、裁切框建议。
- 增加肤色检测稳健性和分区指标。

不要做：

- 不要改 HTTP 路由。
- 不要改 Web UI，除非只是在响应 payload 中新增字段并写后端测试。
- 不要直接读写磁盘文件；核心层保持纯函数。

验收：

- `python3 -m pytest tests/test_calibration.py tests/test_cast_detection.py`
- 胶片扫描新增功能必须用合成图覆盖：水平、轻微旋转、黑边/白边、低置信度失败回退。

### 15.6 Agent D: Backend API / Pipeline / Cache

目标：把 MVP HTTP 服务稳定为桌面应用可复用的 API 层，完善任务、缓存、批处理和 session。

只负责：

- `src/photo_calibrator/backend/simple_server.py`
- 可新增 `src/photo_calibrator/backend/schemas.py`
- 可新增 `src/photo_calibrator/pipeline/`
- `tests/test_simple_server_api.py`

可以做：

- 拆分 API schema。
- 增加任务队列、进度查询、批处理取消。
- 增强 session 生命周期、缓存统计、缓存清理 API。
- 增加 sidecar 保存/加载 API。

不要做：

- 不要改核心算法公式。
- 不要改前端 UI 结构，只能新增兼容字段。
- 不要改 accelerator 内部实现。

验收：

- `python3 -m pytest tests/test_simple_server_api.py`
- 所有新增 endpoint 都要有函数级测试；真实 socket 测试在沙箱不允许时可以 skip，但内部 payload 测试必须覆盖。

### 15.7 Agent E: Frontend / UX / Charts

目标：提升 Web UI 的专业工具体验，保持 Playwright 可测。

只负责：

- `web/index.html`
- `web/app.js`
- `web/styles.css`
- `tests/ui/photo_calibrator_ui.spec.js`
- `package.json` 仅限前端脚本或测试依赖

可以做：

- 改进图表、布局、对比模式、遮罩显示。
- 增加批处理上传 UI，调用 `/api/calibrate-batch`。
- 增加预览加载态、错误态、缩略图质量。
- 增加 `data-testid` 并扩展 Playwright 覆盖。

不要做：

- 不要改 Python 算法。
- 不要改 API 字段名；需要新字段时先兼容旧字段。
- 不要引入 React/Electron 大迁移，除非专门开新分支/阶段。

验收：

- `npm run test:ui`
- 如改 API 调用，同时跑 `python3 -m pytest tests/test_simple_server_api.py`
- 视觉改动必须检查移动/桌面基本布局，不允许文字重叠。

### 15.8 Agent F: Plugin / AI / Export

目标：搭建插件、AI 评估和导出配置的可扩展骨架。

只负责：

- 新建/修改 `src/photo_calibrator/plugins/`
- 新建/修改 `src/photo_calibrator/ai/`
- 新建/修改 `src/photo_calibrator/export/`
- 可新增 `tests/test_plugin_manager.py`
- 可新增 `tests/test_ai_evaluator.py`
- 可新增 `tests/test_export.py`

可以做：

- 插件 manifest 校验。
- hook 接口和内置 stub 插件。
- AI evaluator 的 provider-agnostic schema。
- sidecar JSON 和 `.cube` LUT 导出基础。

不要做：

- 不要把网络 AI 调用接入默认流程。
- 不要让 AI 直接修改图像或 pipeline。
- 不要改现有校准算法，只通过 hook/stub 表达扩展点。

验收：

- 插件/AI/export 测试可在无网络、无外部服务环境通过。
- 新增依赖必须是可选依赖或纯 Python 小依赖。

### 15.9 合并前检查清单

每个 agent 完成后在汇报里写：

- 改了哪些文件。
- 新增/修改了哪些 API 或数据字段。
- 跑了哪些测试，原始命令是什么。
- 哪些验证因当前环境缺 GPU/RAW 样例/网络而不能完成。
- 是否触碰了其它 agent 的文件所有权；如果触碰，说明原因。

任意一个 agent 如果修改了以下共享契约，必须提醒其它 agent 同步：

- `/api/calibrate`、`/api/calibrate-session`、`/api/calibrate-batch`、`/api/calibrate-paths` 响应结构。
- `accelerator_payload()` 字段。
- `benchmark_accelerator()` 操作名。
- `CalibrationParams`、`CalibrationResult`。
- 前端 `data-testid`。

## 16. 下一步执行清单

后续 agent 应按顺序执行：

1. 新建 `pyproject.toml`、包目录和测试目录。
2. 从旧脚本提取纯算法函数，保持行为一致。
3. 添加合成图测试，覆盖全局偏红/偏绿/偏黄/偏蓝和高光区域偏色。
4. 增加 `ImageBuffer`，把 8-bit OpenCV 路线替换为 dtype-aware 路线。
5. 做后端 API smoke test：打开图像、生成预览、返回检测报告、应用校准参数。
6. 做 Web UI MVP，并用 Playwright 验证主流程。
7. 再接入 Electron shell、RAW/TIFF/HDR、插件和 AI。

不要在第一个开发迭代里同时做完整 UI、RAW、OCIO、插件、AI。先把核心库、数据模型和后端 API 打稳，否则后续会被 UI 代码锁死。
