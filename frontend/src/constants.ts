export const MODE_OPTIONS = [
  ["auto-best", "自动选择最佳"],
  ["global", "全局校准"],
  ["midtones-only", "中间调"],
  ["skin-priority", "肤色优先"],
  ["highlights-only", "高光优先"],
  ["preserve-split-tone", "保留分离色调"],
  ["tone-zone", "分区校正"],
  ["matrix", "3x3 矩阵"],
  ["lut3d", "3D LUT"],
  ["selective", "选择性色彩"],
  ["film", "胶片校准"],
] as const;

export const ACCELERATOR_OPTIONS = [
  ["auto", "Auto"],
  ["cpu-opencv", "CPU OpenCV"],
  ["opencl-umat", "OpenCL UMat"],
  ["torch", "Torch Auto"],
  ["torch-cuda", "Torch CUDA"],
  ["torch-mps", "Torch MPS"],
] as const;

export const MODE_DESCRIPTIONS: Record<string, string> = {
  "auto-best": "自动试算多个候选校准模式，根据残余偏色、通道平衡和改善幅度选择当前图像最合适的一种。",
  global: "基于 Lab a*/b* 全局偏移的通用校准，适合大多数场景。",
  "midtones-only": "仅对中间亮度区域（约 30%–70%）施加补偿，保留阴影和高光原本的色调。",
  "skin-priority": "优先检测并保护肤色区域，避免肤色因全局校准而失真。",
  "highlights-only": "仅对高光区域（亮度 > 70%）施加补偿，保留阴影和中间调不变。",
  "preserve-split-tone": "在全局 Lab 偏移基础上进一步保持亮部/暗部的分离色调关系。",
  "rgb-curves": "通过 RGB 三通道独立的 S 形曲线调整对比度和色彩平衡。",
  "tone-zone": "将亮度分为多区（阴影/中间调/高光），分别进行独立的 a*/b* 偏移补偿。",
  matrix: "使用 3×3 矩阵在 RGB 空间进行线性色彩校正，适合精确色彩匹配。",
  lut3d: "通过 3D LUT 对 RGB 空间进行非线性映射，可实现复杂的色彩变换。",
  selective: "针对特定色彩区域的 a*/b* 偏移，保留图像其余部分不变。",
  film: "面向胶片扫描特征的专用校准，适合胶片翻拍场景的颜色还原。",
  "negative-film": "旧版兼容模式：负片正片化并做轻量整理。新流程建议使用“负片基础处理”开关后叠加其他模式。",
};
