from __future__ import annotations

import os
import time
from dataclasses import dataclass
from importlib import import_module

import cv2
import numpy as np


@dataclass(frozen=True)
class AcceleratorInfo:
    requested_backend: str
    active_backend: str
    opencv_optimized: bool
    opencv_threads: int
    opencl_available: bool
    opencl_enabled: bool
    accelerated_ops: tuple[str, ...]
    cpu_fallback_ops: tuple[str, ...]
    gpu_ops: tuple[str, ...]
    gpu_note: str
    fallback_reason: str = ""


class ImageAccelerator:
    name = "cpu-opencv"
    accelerated_ops = ("resize", "rgb-lab", "lab-rgb", "curve-lut", "matrix", "histogram")
    cpu_fallback_ops = ("3d-lut",)

    def __init__(self, fallback_reason: str = "") -> None:
        self.fallback_reason = fallback_reason

    def bgr_to_rgb(self, bgr: np.ndarray) -> np.ndarray:
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    def rgb_to_bgr(self, rgb: np.ndarray) -> np.ndarray:
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    def rgb_to_hsv(self, rgb: np.ndarray) -> np.ndarray:
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)

    def rgb_to_gray_u8(self, rgb: np.ndarray) -> np.ndarray:
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    def rgb_to_lab_float(self, rgb: np.ndarray) -> np.ndarray:
        rgb_float = rgb.astype(np.float32) / 255.0
        return cv2.cvtColor(rgb_float, cv2.COLOR_RGB2Lab)

    def lab_to_rgb_uint8(self, lab: np.ndarray) -> np.ndarray:
        rgb = self.lab_to_rgb_float(lab)
        return np.clip(rgb * 255.0, 0, 255).astype(np.uint8)

    def lab_to_rgb_float(self, lab: np.ndarray) -> np.ndarray:
        return cv2.cvtColor(lab.astype(np.float32, copy=False), cv2.COLOR_Lab2RGB)

    def resize_area(self, img: np.ndarray, target: tuple[int, int]) -> np.ndarray:
        return cv2.resize(img, target, interpolation=cv2.INTER_AREA)

    def gaussian_blur(self, img: np.ndarray, ksize: tuple[int, int], sigma: float = 0.0) -> np.ndarray:
        return cv2.GaussianBlur(img, ksize, sigma)

    def sobel_abs_mean(self, gray: np.ndarray, dx: int, dy: int, axis: int) -> np.ndarray:
        sobel = cv2.Sobel(gray, cv2.CV_32F, dx, dy, ksize=3)
        return np.mean(np.abs(sobel), axis=axis)

    def calc_hist(self, img_rgb: np.ndarray, channel: int, bins: int, mask: np.ndarray | None = None) -> np.ndarray:
        return cv2.calcHist([img_rgb], [channel], mask, [bins], [0, 256]).reshape(-1)

    def apply_channel_luts(self, img_rgb: np.ndarray, luts: list[np.ndarray]) -> np.ndarray:
        channels = cv2.split(img_rgb)
        corrected = [cv2.LUT(channel, luts[index]) for index, channel in enumerate(channels)]
        return cv2.merge(corrected)

    def apply_color_matrix(self, src_float: np.ndarray, matrix: np.ndarray) -> np.ndarray:
        return cv2.transform(src_float, matrix)

    def apply_3d_lut(self, src_float: np.ndarray, table: np.ndarray, strength: float) -> np.ndarray:
        n = table.shape[0]
        coords = np.clip(src_float * (n - 1), 0, n - 1)
        lo = np.floor(coords).astype(np.int32)
        hi = np.clip(lo + 1, 0, n - 1)
        frac = coords - lo

        r0, g0, b0 = lo[:, :, 0], lo[:, :, 1], lo[:, :, 2]
        r1, g1, b1 = hi[:, :, 0], hi[:, :, 1], hi[:, :, 2]
        fr = frac[:, :, 0:1]
        fg = frac[:, :, 1:2]
        fb = frac[:, :, 2:3]

        c000 = table[r0, g0, b0]
        c100 = table[r1, g0, b0]
        c010 = table[r0, g1, b0]
        c110 = table[r1, g1, b0]
        c001 = table[r0, g0, b1]
        c101 = table[r1, g0, b1]
        c011 = table[r0, g1, b1]
        c111 = table[r1, g1, b1]

        c00 = c000 * (1.0 - fr) + c100 * fr
        c10 = c010 * (1.0 - fr) + c110 * fr
        c01 = c001 * (1.0 - fr) + c101 * fr
        c11 = c011 * (1.0 - fr) + c111 * fr
        c0 = c00 * (1.0 - fg) + c10 * fg
        c1 = c01 * (1.0 - fg) + c11 * fg
        corrected = c0 * (1.0 - fb) + c1 * fb
        return src_float * (1.0 - strength) + corrected * strength

    def info(self, requested_backend: str) -> AcceleratorInfo:
        return AcceleratorInfo(
            requested_backend=requested_backend,
            active_backend=self.name,
            opencv_optimized=bool(cv2.useOptimized()),
            opencv_threads=int(cv2.getNumThreads()),
            opencl_available=bool(cv2.ocl.haveOpenCL()),
            opencl_enabled=bool(cv2.ocl.useOpenCL()),
            accelerated_ops=self.accelerated_ops,
            cpu_fallback_ops=self.cpu_fallback_ops,
            gpu_ops=(),
            gpu_note="CPU OpenCV backend is active. GPU-specific backends can fall back to this path per operation.",
            fallback_reason=self.fallback_reason,
        )


class OpenCLUMatAccelerator(ImageAccelerator):
    name = "opencl-umat"
    accelerated_ops = ("resize", "rgb-gray", "gaussian-blur", "sobel-profile", "rgb-lab", "lab-rgb", "curve-lut", "matrix", "histogram")
    cpu_fallback_ops = ("3d-lut",)

    def _run(self, img: np.ndarray, fn, fallback):
        try:
            umat = cv2.UMat(img)
            result = fn(umat)
            return result.get() if hasattr(result, "get") else result
        except Exception:
            return fallback()

    def bgr_to_rgb(self, bgr: np.ndarray) -> np.ndarray:
        return self._run(bgr, lambda umat: cv2.cvtColor(umat, cv2.COLOR_BGR2RGB), lambda: ImageAccelerator.bgr_to_rgb(self, bgr))

    def rgb_to_bgr(self, rgb: np.ndarray) -> np.ndarray:
        return self._run(rgb, lambda umat: cv2.cvtColor(umat, cv2.COLOR_RGB2BGR), lambda: ImageAccelerator.rgb_to_bgr(self, rgb))

    def rgb_to_hsv(self, rgb: np.ndarray) -> np.ndarray:
        return self._run(rgb, lambda umat: cv2.cvtColor(umat, cv2.COLOR_RGB2HSV), lambda: ImageAccelerator.rgb_to_hsv(self, rgb))

    def rgb_to_gray_u8(self, rgb: np.ndarray) -> np.ndarray:
        return self._run(rgb, lambda umat: cv2.cvtColor(umat, cv2.COLOR_RGB2GRAY), lambda: ImageAccelerator.rgb_to_gray_u8(self, rgb))

    def rgb_to_lab_float(self, rgb: np.ndarray) -> np.ndarray:
        rgb_float = rgb.astype(np.float32) / 255.0
        return self._run(
            rgb_float,
            lambda umat: cv2.cvtColor(umat, cv2.COLOR_RGB2Lab),
            lambda: ImageAccelerator.rgb_to_lab_float(self, rgb),
        )

    def lab_to_rgb_uint8(self, lab: np.ndarray) -> np.ndarray:
        rgb = self._run(lab, lambda umat: cv2.cvtColor(umat, cv2.COLOR_Lab2RGB), lambda: cv2.cvtColor(lab, cv2.COLOR_Lab2RGB))
        return np.clip(rgb * 255.0, 0, 255).astype(np.uint8)

    def resize_area(self, img: np.ndarray, target: tuple[int, int]) -> np.ndarray:
        return self._run(
            img,
            lambda umat: cv2.resize(umat, target, interpolation=cv2.INTER_AREA),
            lambda: ImageAccelerator.resize_area(self, img, target),
        )

    def gaussian_blur(self, img: np.ndarray, ksize: tuple[int, int], sigma: float = 0.0) -> np.ndarray:
        return self._run(
            img,
            lambda umat: cv2.GaussianBlur(umat, ksize, sigma),
            lambda: ImageAccelerator.gaussian_blur(self, img, ksize, sigma),
        )

    def sobel_abs_mean(self, gray: np.ndarray, dx: int, dy: int, axis: int) -> np.ndarray:
        sobel = self._run(
            gray,
            lambda umat: cv2.Sobel(umat, cv2.CV_32F, dx, dy, ksize=3),
            lambda: cv2.Sobel(gray, cv2.CV_32F, dx, dy, ksize=3),
        )
        return np.mean(np.abs(sobel), axis=axis)

    def apply_channel_luts(self, img_rgb: np.ndarray, luts: list[np.ndarray]) -> np.ndarray:
        channels = cv2.split(img_rgb)
        corrected = [
            self._run(channel, lambda umat, lut=lut: cv2.LUT(umat, lut), lambda channel=channel, lut=lut: cv2.LUT(channel, lut))
            for channel, lut in zip(channels, luts, strict=True)
        ]
        return cv2.merge(corrected)

    def apply_color_matrix(self, src_float: np.ndarray, matrix: np.ndarray) -> np.ndarray:
        return self._run(
            src_float,
            lambda umat: cv2.transform(umat, matrix),
            lambda: ImageAccelerator.apply_color_matrix(self, src_float, matrix),
        )

    def info(self, requested_backend: str) -> AcceleratorInfo:
        info = super().info(requested_backend)
        return AcceleratorInfo(
            requested_backend=info.requested_backend,
            active_backend=self.name,
            opencv_optimized=info.opencv_optimized,
            opencv_threads=info.opencv_threads,
            opencl_available=info.opencl_available,
            opencl_enabled=info.opencl_enabled,
            accelerated_ops=self.accelerated_ops,
            cpu_fallback_ops=self.cpu_fallback_ops,
            gpu_ops=self.accelerated_ops,
            gpu_note="OpenCL UMat is active for resize, RGB/Lab conversion, curve LUT, matrix transforms, and histograms. 3D LUT keeps CPU fallback until a dedicated kernel is added.",
            fallback_reason=info.fallback_reason,
        )


class TorchAccelerator(ImageAccelerator):
    """Optional CUDA/MPS backend for LUT-style operations.

    OpenCV remains the fallback for operations that need mature color science
    kernels, while Torch handles GPU-friendly resize and per-pixel transforms.
    """

    accelerated_ops = ("resize", "rgb-gray", "rgb-lab", "lab-rgb", "curve-lut", "matrix", "3d-lut")
    cpu_fallback_ops = ("histogram",)

    def __init__(self, torch_module=None, device: str | None = None) -> None:
        super().__init__()
        self.torch = torch_module or import_module("torch")
        self.device = device or self._select_device()
        if self.device is None:
            raise RuntimeError("Torch is installed but no CUDA or MPS device is available")
        self.name = f"torch-{self.device}"

    def _select_device(self) -> str | None:
        if getattr(self.torch.cuda, "is_available", lambda: False)():
            return "cuda"
        mps = getattr(getattr(self.torch, "backends", None), "mps", None)
        if mps is not None and getattr(mps, "is_available", lambda: False)():
            return "mps"
        return None

    def _tensor(self, arr: np.ndarray):
        return self.torch.as_tensor(arr, device=self.device)

    def _to_numpy(self, tensor) -> np.ndarray:
        return tensor.detach().to("cpu").numpy()

    def rgb_to_lab_float(self, rgb: np.ndarray) -> np.ndarray:
        try:
            rgb_t = self._tensor(rgb.astype(np.float32) / 255.0)
            linear = self.torch.where(
                rgb_t <= 0.04045,
                rgb_t / 12.92,
                self.torch.pow((rgb_t + 0.055) / 1.055, 2.4),
            )
            r = linear[:, :, 0]
            g = linear[:, :, 1]
            b = linear[:, :, 2]
            x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047
            y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
            z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883
            xyz = self.torch.stack([x, y, z], dim=2)
            eps = 0.008856
            kappa = 903.3
            f = self.torch.where(
                xyz > eps,
                self.torch.pow(xyz, 1.0 / 3.0),
                (kappa * xyz + 16.0) / 116.0,
            )
            l_ch = 116.0 * f[:, :, 1] - 16.0
            a_ch = 500.0 * (f[:, :, 0] - f[:, :, 1])
            b_ch = 200.0 * (f[:, :, 1] - f[:, :, 2])
            return self._to_numpy(self.torch.stack([l_ch, a_ch, b_ch], dim=2)).astype(np.float32)
        except Exception:
            return ImageAccelerator.rgb_to_lab_float(self, rgb)

    def rgb_to_gray_u8(self, rgb: np.ndarray) -> np.ndarray:
        try:
            rgb_t = self._tensor(rgb.astype(np.float32))
            gray = rgb_t[:, :, 0] * 0.299 + rgb_t[:, :, 1] * 0.587 + rgb_t[:, :, 2] * 0.114
            return np.clip(np.rint(self._to_numpy(gray)), 0, 255).astype(np.uint8)
        except Exception:
            return ImageAccelerator.rgb_to_gray_u8(self, rgb)

    def lab_to_rgb_uint8(self, lab: np.ndarray) -> np.ndarray:
        try:
            lab_t = self._tensor(lab.astype(np.float32))
            l_ch = lab_t[:, :, 0]
            a_ch = lab_t[:, :, 1]
            b_ch = lab_t[:, :, 2]
            fy = (l_ch + 16.0) / 116.0
            fx = fy + a_ch / 500.0
            fz = fy - b_ch / 200.0
            f = self.torch.stack([fx, fy, fz], dim=2)
            eps = 0.008856
            kappa = 903.3
            f3 = f * f * f
            xyz = self.torch.where(
                f3 > eps,
                f3,
                (116.0 * f - 16.0) / kappa,
            )
            x = xyz[:, :, 0] * 0.95047
            y = xyz[:, :, 1]
            z = xyz[:, :, 2] * 1.08883
            r_linear = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
            g_linear = x * -0.9692660 + y * 1.8760108 + z * 0.0415560
            b_linear = x * 0.0556434 + y * -0.2040259 + z * 1.0572252
            linear = self.torch.clamp(self.torch.stack([r_linear, g_linear, b_linear], dim=2), 0.0, 1.0)
            rgb = self.torch.where(
                linear <= 0.0031308,
                linear * 12.92,
                1.055 * self.torch.pow(linear, 1.0 / 2.4) - 0.055,
            )
            return np.clip(np.rint(self._to_numpy(rgb) * 255.0), 0, 255).astype(np.uint8)
        except Exception:
            return ImageAccelerator.lab_to_rgb_uint8(self, lab)

    def resize_area(self, img: np.ndarray, target: tuple[int, int]) -> np.ndarray:
        try:
            if img.ndim not in {2, 3}:
                return ImageAccelerator.resize_area(self, img, target)
            src_t = self._tensor(img.astype(np.float32))
            if img.ndim == 2:
                src_t = src_t[None, None, :, :]
            else:
                src_t = src_t.permute(2, 0, 1)[None, :, :, :]
            resized = self.torch.nn.functional.interpolate(
                src_t,
                size=(int(target[1]), int(target[0])),
                mode="area",
            )
            if img.ndim == 2:
                out = self._to_numpy(resized[0, 0])
            else:
                out = self._to_numpy(resized[0].permute(1, 2, 0))
            if np.issubdtype(img.dtype, np.integer):
                return np.clip(np.rint(out), 0, np.iinfo(img.dtype).max).astype(img.dtype)
            return out.astype(img.dtype, copy=False)
        except Exception:
            return ImageAccelerator.resize_area(self, img, target)

    def gaussian_blur(self, img: np.ndarray, ksize: tuple[int, int], sigma: float = 0.0) -> np.ndarray:
        return ImageAccelerator.gaussian_blur(self, img, ksize, sigma)

    def sobel_abs_mean(self, gray: np.ndarray, dx: int, dy: int, axis: int) -> np.ndarray:
        try:
            src_t = self._tensor(gray.astype(np.float32))[None, None, :, :]
            if dx == 1 and dy == 0:
                kernel = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float32)
            elif dx == 0 and dy == 1:
                kernel = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=np.float32)
            else:
                return ImageAccelerator.sobel_abs_mean(self, gray, dx, dy, axis)
            kernel_t = self._tensor(kernel)[None, None, :, :]
            sobel = self.torch.nn.functional.conv2d(src_t, kernel_t, padding=1)
            out = self._to_numpy(sobel[0, 0])
            return np.mean(np.abs(out), axis=axis)
        except Exception:
            return ImageAccelerator.sobel_abs_mean(self, gray, dx, dy, axis)

    def apply_channel_luts(self, img_rgb: np.ndarray, luts: list[np.ndarray]) -> np.ndarray:
        try:
            img_t = self._tensor(img_rgb.astype(np.int64))
            lut_t = self._tensor(np.stack(luts, axis=0).astype(np.uint8))
            channels = [lut_t[index][img_t[:, :, index]] for index in range(3)]
            return self._to_numpy(self.torch.stack(channels, dim=2)).astype(np.uint8)
        except Exception:
            return ImageAccelerator.apply_channel_luts(self, img_rgb, luts)

    def apply_color_matrix(self, src_float: np.ndarray, matrix: np.ndarray) -> np.ndarray:
        try:
            src_t = self._tensor(src_float.astype(np.float32))
            mat_t = self._tensor(matrix.astype(np.float32))
            return self._to_numpy(self.torch.matmul(src_t, mat_t.T)).astype(np.float32)
        except Exception:
            return ImageAccelerator.apply_color_matrix(self, src_float, matrix)

    def apply_3d_lut(self, src_float: np.ndarray, table: np.ndarray, strength: float) -> np.ndarray:
        try:
            src_t = self._tensor(src_float.astype(np.float32))
            table_t = self._tensor(table.astype(np.float32))
            n = int(table.shape[0])
            coords = self.torch.clamp(src_t * (n - 1), 0, n - 1)
            lo = self.torch.floor(coords).to(self.torch.long)
            hi = self.torch.clamp(lo + 1, 0, n - 1)
            frac = coords - lo.to(src_t.dtype)

            r0, g0, b0 = lo[:, :, 0], lo[:, :, 1], lo[:, :, 2]
            r1, g1, b1 = hi[:, :, 0], hi[:, :, 1], hi[:, :, 2]
            fr = frac[:, :, 0:1]
            fg = frac[:, :, 1:2]
            fb = frac[:, :, 2:3]

            c000 = table_t[r0, g0, b0]
            c100 = table_t[r1, g0, b0]
            c010 = table_t[r0, g1, b0]
            c110 = table_t[r1, g1, b0]
            c001 = table_t[r0, g0, b1]
            c101 = table_t[r1, g0, b1]
            c011 = table_t[r0, g1, b1]
            c111 = table_t[r1, g1, b1]

            c00 = c000 * (1.0 - fr) + c100 * fr
            c10 = c010 * (1.0 - fr) + c110 * fr
            c01 = c001 * (1.0 - fr) + c101 * fr
            c11 = c011 * (1.0 - fr) + c111 * fr
            c0 = c00 * (1.0 - fg) + c10 * fg
            c1 = c01 * (1.0 - fg) + c11 * fg
            corrected = c0 * (1.0 - fb) + c1 * fb
            out = src_t * (1.0 - strength) + corrected * strength
            return self._to_numpy(out).astype(np.float32)
        except Exception:
            return ImageAccelerator.apply_3d_lut(self, src_float, table, strength)

    def info(self, requested_backend: str) -> AcceleratorInfo:
        base = ImageAccelerator.info(self, requested_backend)
        return AcceleratorInfo(
            requested_backend=base.requested_backend,
            active_backend=self.name,
            opencv_optimized=base.opencv_optimized,
            opencv_threads=base.opencv_threads,
            opencl_available=base.opencl_available,
            opencl_enabled=base.opencl_enabled,
            accelerated_ops=self.accelerated_ops,
            cpu_fallback_ops=self.cpu_fallback_ops,
            gpu_ops=self.accelerated_ops,
            gpu_note="Torch backend is active for resize, RGB/Lab conversion, curve LUT, matrix, and 3D LUT. OpenCV CPU fallback remains active for histograms.",
            fallback_reason="",
        )


class HybridTorchOpenCLAccelerator(ImageAccelerator):
    """Combine OpenCL image kernels with Torch per-pixel GPU transforms."""

    accelerated_ops = ("resize", "rgb-gray", "gaussian-blur", "sobel-profile", "rgb-lab", "lab-rgb", "curve-lut", "matrix", "histogram", "3d-lut")
    cpu_fallback_ops: tuple[str, ...] = ()

    def __init__(self, torch_accelerator: TorchAccelerator, opencl_accelerator: OpenCLUMatAccelerator | None = None) -> None:
        super().__init__()
        self.torch_accelerator = torch_accelerator
        self.opencl_accelerator = opencl_accelerator or OpenCLUMatAccelerator()
        self.name = f"hybrid-opencl-{torch_accelerator.device}"

    def bgr_to_rgb(self, bgr: np.ndarray) -> np.ndarray:
        return self.opencl_accelerator.bgr_to_rgb(bgr)

    def rgb_to_bgr(self, rgb: np.ndarray) -> np.ndarray:
        return self.opencl_accelerator.rgb_to_bgr(rgb)

    def rgb_to_hsv(self, rgb: np.ndarray) -> np.ndarray:
        return self.opencl_accelerator.rgb_to_hsv(rgb)

    def rgb_to_gray_u8(self, rgb: np.ndarray) -> np.ndarray:
        return self.opencl_accelerator.rgb_to_gray_u8(rgb)

    def rgb_to_lab_float(self, rgb: np.ndarray) -> np.ndarray:
        return self.opencl_accelerator.rgb_to_lab_float(rgb)

    def lab_to_rgb_uint8(self, lab: np.ndarray) -> np.ndarray:
        return self.opencl_accelerator.lab_to_rgb_uint8(lab)

    def resize_area(self, img: np.ndarray, target: tuple[int, int]) -> np.ndarray:
        return self.opencl_accelerator.resize_area(img, target)

    def gaussian_blur(self, img: np.ndarray, ksize: tuple[int, int], sigma: float = 0.0) -> np.ndarray:
        return self.opencl_accelerator.gaussian_blur(img, ksize, sigma)

    def sobel_abs_mean(self, gray: np.ndarray, dx: int, dy: int, axis: int) -> np.ndarray:
        return self.opencl_accelerator.sobel_abs_mean(gray, dx, dy, axis)

    def calc_hist(self, img_rgb: np.ndarray, channel: int, bins: int, mask: np.ndarray | None = None) -> np.ndarray:
        return self.opencl_accelerator.calc_hist(img_rgb, channel, bins, mask)

    def apply_channel_luts(self, img_rgb: np.ndarray, luts: list[np.ndarray]) -> np.ndarray:
        return self.torch_accelerator.apply_channel_luts(img_rgb, luts)

    def apply_color_matrix(self, src_float: np.ndarray, matrix: np.ndarray) -> np.ndarray:
        return self.torch_accelerator.apply_color_matrix(src_float, matrix)

    def apply_3d_lut(self, src_float: np.ndarray, table: np.ndarray, strength: float) -> np.ndarray:
        return self.torch_accelerator.apply_3d_lut(src_float, table, strength)

    def info(self, requested_backend: str) -> AcceleratorInfo:
        base = self.opencl_accelerator.info(requested_backend)
        return AcceleratorInfo(
            requested_backend=base.requested_backend,
            active_backend=self.name,
            opencv_optimized=base.opencv_optimized,
            opencv_threads=base.opencv_threads,
            opencl_available=base.opencl_available,
            opencl_enabled=base.opencl_enabled,
            accelerated_ops=self.accelerated_ops,
            cpu_fallback_ops=self.cpu_fallback_ops,
            gpu_ops=self.accelerated_ops,
            gpu_note="Hybrid backend is active: OpenCL UMat handles resize, RGB/Lab conversion, and histograms; Torch handles curve LUT, matrix, and 3D LUT.",
            fallback_reason="",
        )


def create_accelerator(requested_backend: str = "auto") -> ImageAccelerator:
    backend = (requested_backend or "auto").lower()
    if backend in {"cpu", "cpu-opencv"}:
        cv2.ocl.setUseOpenCL(False)
        return ImageAccelerator()

    torch_error = ""
    if backend in {"auto", "torch", "torch-cuda", "torch-mps", "metal", "metal-mps"}:
        try:
            device = None
            if backend == "torch-cuda":
                device = "cuda"
            elif backend in {"torch-mps", "metal", "metal-mps"}:
                device = "mps"
            torch_acc = TorchAccelerator(device=device)
            if backend == "auto":
                cv2.ocl.setUseOpenCL(True)
                if cv2.ocl.haveOpenCL() and cv2.ocl.useOpenCL():
                    return HybridTorchOpenCLAccelerator(torch_acc)
            if backend != "auto" or torch_acc.device in {"cuda", "mps"}:
                return torch_acc
        except Exception as exc:
            torch_error = str(exc)
            if backend in {"torch", "torch-cuda", "torch-mps", "metal", "metal-mps"}:
                cv2.ocl.setUseOpenCL(False)
                return ImageAccelerator(fallback_reason=f"Requested {backend}, but Torch GPU backend is unavailable: {torch_error}")

    cv2.ocl.setUseOpenCL(backend in {"auto", "opencl", "opencl-umat"})
    if backend in {"auto", "opencl", "opencl-umat"} and cv2.ocl.haveOpenCL() and cv2.ocl.useOpenCL():
        return OpenCLUMatAccelerator()
    cv2.ocl.setUseOpenCL(False)
    if backend in {"opencl", "opencl-umat"}:
        return ImageAccelerator(
            fallback_reason=f"Requested {backend}, but OpenCL is unavailable or disabled in this OpenCV runtime."
        )
    reason = "Auto selected CPU fallback."
    if torch_error:
        reason += f" Torch GPU unavailable: {torch_error}."
    if not cv2.ocl.haveOpenCL():
        reason += " OpenCL unavailable."
    return ImageAccelerator(fallback_reason=reason)


class AcceleratorRuntime:
    def __init__(self, requested_backend: str = "auto") -> None:
        self.requested_backend = requested_backend
        self.current = create_accelerator(requested_backend)

    def configure(self, requested_backend: str) -> ImageAccelerator:
        self.requested_backend = requested_backend or "auto"
        self.current = create_accelerator(self.requested_backend)
        return self.current

    def __getattr__(self, name: str):
        return getattr(self.current, name)

    def info(self, requested_backend: str | None = None) -> AcceleratorInfo:
        return self.current.info(requested_backend or self.requested_backend)


REQUESTED_BACKEND = os.environ.get("PHOTO_CALIBRATOR_ACCELERATOR", "auto")
ACCELERATOR = AcceleratorRuntime(REQUESTED_BACKEND)


def set_accelerator_backend(requested_backend: str) -> dict:
    ACCELERATOR.configure(requested_backend)
    return accelerator_payload()


def accelerator_payload(requested_backend: str | None = None) -> dict:
    requested = requested_backend or ACCELERATOR.requested_backend
    info = ACCELERATOR.info(requested)
    return {
        "requested_backend": info.requested_backend,
        "active_backend": info.active_backend,
        "opencv_optimized": info.opencv_optimized,
        "opencv_threads": info.opencv_threads,
        "opencl_available": info.opencl_available,
        "opencl_enabled": info.opencl_enabled,
        "accelerated_ops": list(info.accelerated_ops),
        "cpu_fallback_ops": list(info.cpu_fallback_ops),
        "gpu_ops": list(info.gpu_ops),
        "gpu_note": info.gpu_note,
        "fallback_reason": info.fallback_reason,
        "available_backends": ["cpu-opencv", "opencl-umat", "torch-cuda", "torch-mps", "metal-mps"],
    }


def benchmark_accelerator(image_side: int = 256, lut_size: int = 17, iterations: int = 3) -> dict:
    image_side = int(np.clip(image_side, 32, 2048))
    lut_size = int(np.clip(lut_size, 5, 65))
    iterations = int(np.clip(iterations, 1, 20))
    rng = np.random.default_rng(1234)
    img_rgb = rng.integers(0, 256, size=(image_side, image_side, 3), dtype=np.uint8)
    src_float = img_rgb.astype(np.float32) / 255.0
    lab_float = ImageAccelerator().rgb_to_lab_float(img_rgb)
    luts = [
        np.clip(np.linspace(0, 255, 256, dtype=np.float32) ** 0.98, 0, 255).astype(np.uint8),
        np.arange(256, dtype=np.uint8),
        np.clip(np.linspace(0, 255, 256, dtype=np.float32) * 1.02, 0, 255).astype(np.uint8),
    ]
    matrix = np.array([[1.02, -0.01, -0.01], [-0.02, 1.04, -0.02], [0.01, -0.02, 1.01]], dtype=np.float32)
    axis = np.linspace(0, 1, lut_size, dtype=np.float32)
    r, g, b = np.meshgrid(axis, axis, axis, indexing="ij")
    lut3d = np.stack([np.clip(r * 0.97 + 0.02, 0, 1), g, np.clip(b * 1.03, 0, 1)], axis=-1).astype(np.float32)
    info = accelerator_payload()

    def run(name: str, fn) -> dict:
        output = None
        start = time.perf_counter()
        for _ in range(iterations):
            output = fn()
        elapsed_ms = (time.perf_counter() - start) * 1000.0 / iterations
        checksum = float(np.asarray(output, dtype=np.float64).mean()) if output is not None else 0.0
        device = "gpu" if name in info["gpu_ops"] else "cpu"
        return {
            "name": name,
            "elapsed_ms": elapsed_ms,
            "checksum": checksum,
            "path": "fallback" if name in info["cpu_fallback_ops"] else "accelerated",
            "device": device,
        }

    operations = [
        run("resize", lambda: ACCELERATOR.resize_area(img_rgb, (image_side // 2, image_side // 2))),
        run("rgb-lab", lambda: ACCELERATOR.rgb_to_lab_float(img_rgb)),
        run("lab-rgb", lambda: ACCELERATOR.lab_to_rgb_uint8(lab_float)),
        run("curve-lut", lambda: ACCELERATOR.apply_channel_luts(img_rgb, luts)),
        run("matrix", lambda: ACCELERATOR.apply_color_matrix(src_float, matrix)),
        run("3d-lut", lambda: ACCELERATOR.apply_3d_lut(src_float, lut3d, 0.8)),
    ]
    return {
        "accelerator": info,
        "image_side": image_side,
        "lut_size": lut_size,
        "iterations": iterations,
        "operations": operations,
    }
