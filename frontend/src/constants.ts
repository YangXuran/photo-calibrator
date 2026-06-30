import { t } from "./i18n";

export const MODE_OPTIONS = [
  ["auto-best", t("modes.autoBest")],
  ["global", t("modes.global")],
  ["midtones-only", t("modes.midtonesOnly")],
  ["skin-priority", t("modes.skinPriority")],
  ["highlights-only", t("modes.highlightsOnly")],
  ["preserve-split-tone", t("modes.preserveSplitTone")],
  ["tone-zone", t("modes.toneZone")],
  ["matrix", t("modes.matrix")],
  ["lut3d", "3D LUT"],
  ["selective", t("modes.selective")],
  ["film", t("modes.film")],
] as const;

export const ACCELERATOR_OPTIONS = [
  ["auto", "Auto"],
  ["cpu-opencv", "CPU OpenCV"],
  ["opencl-umat", "OpenCL UMat"],
  ["torch", "Torch Auto"],
  ["torch-cuda", "Torch CUDA"],
  ["torch-mps", "Torch MPS"],
] as const;
