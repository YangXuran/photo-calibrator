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
