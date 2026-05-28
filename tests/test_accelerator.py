from __future__ import annotations

import cv2
import numpy as np
import pytest

from photo_calibrator.core.accelerator import (
    HybridTorchOpenCLAccelerator,
    ImageAccelerator,
    OpenCLUMatAccelerator,
    TorchAccelerator,
    accelerator_payload,
    benchmark_accelerator,
    create_accelerator,
    set_accelerator_backend,
)


BACKEND_NAMES = {"cpu-opencv", "opencl-umat", "torch-cuda", "torch-mps", "hybrid-opencl-cuda", "hybrid-opencl-mps"}
BENCHMARK_OPS = {"resize", "rgb-lab", "lab-rgb", "curve-lut", "matrix", "3d-lut"}


class FakeTensor:
    def __init__(self, data) -> None:
        self.data = np.asarray(data)

    @property
    def T(self):
        return FakeTensor(self.data.T)

    @property
    def dtype(self):
        return self.data.dtype

    def __getitem__(self, item):
        if isinstance(item, tuple):
            item = tuple(part.data if isinstance(part, FakeTensor) else part for part in item)
        elif isinstance(item, FakeTensor):
            item = item.data
        return FakeTensor(self.data[item])

    def permute(self, *dims):
        return FakeTensor(np.transpose(self.data, axes=dims))

    def __add__(self, other):
        other_data = other.data if isinstance(other, FakeTensor) else other
        return FakeTensor(self.data + other_data)

    def __radd__(self, other):
        return self.__add__(other)

    def __sub__(self, other):
        other_data = other.data if isinstance(other, FakeTensor) else other
        return FakeTensor(self.data - other_data)

    def __rsub__(self, other):
        other_data = other.data if isinstance(other, FakeTensor) else other
        return FakeTensor(other_data - self.data)

    def __mul__(self, other):
        other_data = other.data if isinstance(other, FakeTensor) else other
        return FakeTensor(self.data * other_data)

    def __rmul__(self, other):
        return self.__mul__(other)

    def __truediv__(self, other):
        other_data = other.data if isinstance(other, FakeTensor) else other
        return FakeTensor(self.data / other_data)

    def __gt__(self, other):
        other_data = other.data if isinstance(other, FakeTensor) else other
        return FakeTensor(self.data > other_data)

    def __le__(self, other):
        other_data = other.data if isinstance(other, FakeTensor) else other
        return FakeTensor(self.data <= other_data)

    def to(self, dtype_or_device):
        if dtype_or_device == "cpu":
            return self
        return FakeTensor(self.data.astype(dtype_or_device))

    def detach(self):
        return self

    def numpy(self):
        return np.asarray(self.data)

    def mean(self, dim=None, keepdim=False):
        return FakeTensor(np.mean(self.data, axis=dim, keepdims=keepdim))


class FakeTorch:
    long = np.int64

    class cuda:
        @staticmethod
        def is_available():
            return True

    class backends:
        class mps:
            @staticmethod
            def is_available():
                return False

    class nn:
        class functional:
            @staticmethod
            def interpolate(tensor, size, mode="area"):
                if mode != "area":
                    raise ValueError("FakeTorch only supports area interpolation")
                arr = tensor.data
                out_h, out_w = size
                resized = np.empty((arr.shape[0], arr.shape[1], out_h, out_w), dtype=arr.dtype)
                for n in range(arr.shape[0]):
                    for c in range(arr.shape[1]):
                        resized[n, c] = cv2.resize(arr[n, c], (out_w, out_h), interpolation=cv2.INTER_AREA)
                return FakeTensor(resized)

    @staticmethod
    def as_tensor(arr, device=None):
        return FakeTensor(arr)

    @staticmethod
    def stack(items, dim=0):
        return FakeTensor(np.stack([item.data if isinstance(item, FakeTensor) else item for item in items], axis=dim))

    @staticmethod
    def matmul(a, b):
        return FakeTensor(np.matmul(a.data, b.data))

    @staticmethod
    def clamp(tensor, min=None, max=None):
        return FakeTensor(np.clip(tensor.data, min, max))

    @staticmethod
    def floor(tensor):
        return FakeTensor(np.floor(tensor.data))

    @staticmethod
    def pow(tensor, exponent):
        tensor_data = tensor.data if isinstance(tensor, FakeTensor) else tensor
        return FakeTensor(np.power(tensor_data, exponent))

    @staticmethod
    def where(condition, a, b):
        condition_data = condition.data if isinstance(condition, FakeTensor) else condition
        a_data = a.data if isinstance(a, FakeTensor) else a
        b_data = b.data if isinstance(b, FakeTensor) else b
        return FakeTensor(np.where(condition_data, a_data, b_data))


def sample_rgb() -> np.ndarray:
    x = np.linspace(0, 255, 32, dtype=np.uint8)
    xx, yy = np.meshgrid(x, x)
    return np.stack([xx, yy, ((xx.astype(int) + yy.astype(int)) // 2).astype(np.uint8)], axis=2)


def test_cpu_accelerator_matches_opencv_color_and_resize_ops() -> None:
    acc = ImageAccelerator()
    rgb = sample_rgb()
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    assert np.array_equal(acc.bgr_to_rgb(bgr), rgb)
    assert np.array_equal(acc.rgb_to_bgr(rgb), bgr)
    assert np.allclose(acc.rgb_to_lab_float(rgb), cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab))
    assert acc.resize_area(rgb, (12, 10)).shape == (10, 12, 3)


def test_accelerator_channel_lut_and_matrix_ops_are_consistent() -> None:
    acc = ImageAccelerator()
    rgb = sample_rgb()
    luts = [np.arange(255, -1, -1, dtype=np.uint8), np.arange(256, dtype=np.uint8), np.zeros(256, dtype=np.uint8)]
    out = acc.apply_channel_luts(rgb, luts)

    assert out.shape == rgb.shape
    assert np.array_equal(out[:, :, 0], 255 - rgb[:, :, 0])
    assert np.array_equal(out[:, :, 1], rgb[:, :, 1])
    assert np.count_nonzero(out[:, :, 2]) == 0

    src = rgb.astype(np.float32) / 255.0
    mat = np.eye(3, dtype=np.float32)
    assert np.allclose(acc.apply_color_matrix(src, mat), src)


def test_cpu_3d_lut_uses_full_trilinear_interpolation() -> None:
    acc = ImageAccelerator()
    src = np.array([[[0.25, 0.5, 0.75]]], dtype=np.float32)
    table = np.zeros((2, 2, 2, 3), dtype=np.float32)
    for r in range(2):
        for g in range(2):
            for b in range(2):
                value = r * 0.1 + g * 0.2 + b * 0.4
                table[r, g, b] = [value, value, value]

    out = acc.apply_3d_lut(src, table, 1.0)

    assert np.allclose(out[0, 0], [0.425, 0.425, 0.425], atol=1e-6)


def test_opencl_accelerator_falls_back_per_operation_when_needed() -> None:
    acc = OpenCLUMatAccelerator()
    rgb = sample_rgb()

    assert acc.rgb_to_lab_float(rgb).shape == rgb.shape
    assert acc.apply_channel_luts(rgb, [np.arange(256, dtype=np.uint8)] * 3).shape == rgb.shape
    assert acc.apply_color_matrix(rgb.astype(np.float32) / 255.0, np.eye(3, dtype=np.float32)).shape == rgb.shape


def test_accelerator_payload_names_accelerated_and_fallback_ops() -> None:
    payload = accelerator_payload()

    assert payload["active_backend"] in BACKEND_NAMES
    assert "fallback_reason" in payload
    assert "gpu_ops" in payload
    assert "rgb-lab" in payload["accelerated_ops"]
    assert "curve-lut" in payload["accelerated_ops"]
    assert "matrix" in payload["accelerated_ops"]
    if payload["active_backend"].startswith(("torch-", "hybrid-")):
        assert "3d-lut" in payload["accelerated_ops"]
        assert "3d-lut" in payload["gpu_ops"]
    else:
        assert "3d-lut" in payload["cpu_fallback_ops"]
    if payload["active_backend"] == "cpu-opencv":
        assert payload["gpu_ops"] == []


def test_accelerator_benchmark_runs_required_ops() -> None:
    payload = benchmark_accelerator(image_side=64, lut_size=7, iterations=1)
    operations = {item["name"]: item for item in payload["operations"]}

    assert set(operations) == BENCHMARK_OPS
    assert payload["accelerator"]["active_backend"] in BACKEND_NAMES
    assert all(item["elapsed_ms"] >= 0 for item in operations.values())
    assert operations["3d-lut"]["path"] in {"accelerated", "fallback"}
    assert operations["3d-lut"]["device"] in {"cpu", "gpu"}
    assert operations["lab-rgb"]["path"] in {"accelerated", "fallback"}
    assert operations["lab-rgb"]["device"] in {"cpu", "gpu"}


def test_benchmark_ops_are_all_declared_by_accelerator_capability() -> None:
    payload = benchmark_accelerator(image_side=64, lut_size=7, iterations=1)
    accelerator = payload["accelerator"]
    accelerated = set(accelerator["accelerated_ops"])
    fallback = set(accelerator["cpu_fallback_ops"])
    gpu = set(accelerator["gpu_ops"])

    assert BENCHMARK_OPS <= accelerated | fallback
    assert not accelerated & fallback
    assert gpu <= accelerated
    for operation in payload["operations"]:
        name = operation["name"]
        assert operation["path"] == ("fallback" if name in fallback else "accelerated")
        assert operation["device"] == ("gpu" if name in gpu else "cpu")


def test_requested_torch_backend_falls_back_to_cpu_when_unavailable() -> None:
    acc = create_accelerator("torch")

    assert acc.name in BACKEND_NAMES


def test_runtime_backend_selection_keeps_stable_fallback() -> None:
    original = accelerator_payload()["requested_backend"]
    try:
        cpu_payload = set_accelerator_backend("cpu-opencv")
        assert cpu_payload["requested_backend"] == "cpu-opencv"
        assert cpu_payload["active_backend"] == "cpu-opencv"
        assert cpu_payload["opencl_enabled"] is False

        torch_payload = set_accelerator_backend("torch")
        assert torch_payload["requested_backend"] == "torch"
        assert torch_payload["active_backend"] in {"cpu-opencv", "torch-cuda", "torch-mps"}
        if torch_payload["active_backend"] == "cpu-opencv":
            assert "Torch GPU backend is unavailable" in torch_payload["fallback_reason"]
    finally:
        set_accelerator_backend(original)


def test_torch_accelerator_3d_lut_path_matches_cpu_with_fake_torch() -> None:
    cpu = ImageAccelerator()
    torch_acc = TorchAccelerator(torch_module=FakeTorch(), device="cuda")
    src = sample_rgb().astype(np.float32) / 255.0
    table = np.zeros((5, 5, 5, 3), dtype=np.float32)
    axis = np.linspace(0, 1, 5, dtype=np.float32)
    r, g, b = np.meshgrid(axis, axis, axis, indexing="ij")
    table[:, :, :, 0] = np.clip(r * 0.9 + 0.05, 0, 1)
    table[:, :, :, 1] = g
    table[:, :, :, 2] = np.clip(b * 1.05, 0, 1)

    expected = cpu.apply_3d_lut(src, table, 0.75)
    actual = torch_acc.apply_3d_lut(src, table, 0.75)

    assert torch_acc.name == "torch-cuda"
    assert np.allclose(actual, expected, atol=1e-5)


def test_torch_accelerator_lut_and_matrix_paths_with_fake_torch() -> None:
    torch_acc = TorchAccelerator(torch_module=FakeTorch(), device="cuda")
    rgb = sample_rgb()
    luts = [np.arange(255, -1, -1, dtype=np.uint8), np.arange(256, dtype=np.uint8), np.zeros(256, dtype=np.uint8)]
    lut_out = torch_acc.apply_channel_luts(rgb, luts)

    assert np.array_equal(lut_out[:, :, 0], 255 - rgb[:, :, 0])
    assert np.array_equal(lut_out[:, :, 1], rgb[:, :, 1])
    assert np.count_nonzero(lut_out[:, :, 2]) == 0

    src = rgb.astype(np.float32) / 255.0
    mat = np.eye(3, dtype=np.float32)
    assert np.allclose(torch_acc.apply_color_matrix(src, mat), src)


def test_torch_accelerator_resize_path_with_fake_torch() -> None:
    torch_acc = TorchAccelerator(torch_module=FakeTorch(), device="cuda")
    rgb = sample_rgb()
    out = torch_acc.resize_area(rgb, (12, 10))

    assert out.shape == (10, 12, 3)
    assert out.dtype == rgb.dtype
    assert np.allclose(out, cv2.resize(rgb, (12, 10), interpolation=cv2.INTER_AREA), atol=1)
    assert "resize" in torch_acc.info("torch").gpu_ops
    assert "resize" not in torch_acc.info("torch").cpu_fallback_ops


def test_torch_accelerator_lab_paths_with_fake_torch() -> None:
    torch_acc = TorchAccelerator(torch_module=FakeTorch(), device="cuda")
    rgb = sample_rgb()
    expected_lab = cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)
    actual_lab = torch_acc.rgb_to_lab_float(rgb)
    roundtrip = torch_acc.lab_to_rgb_uint8(actual_lab)

    assert actual_lab.shape == expected_lab.shape
    assert np.allclose(actual_lab, expected_lab, atol=1.1)
    assert np.mean(np.abs(roundtrip.astype(np.int16) - rgb.astype(np.int16))) < 2.0
    info = torch_acc.info("torch")
    assert "rgb-lab" in info.gpu_ops
    assert "lab-rgb" in info.gpu_ops
    assert "rgb-lab" not in info.cpu_fallback_ops


def test_hybrid_accelerator_combines_opencl_and_torch_gpu_ops() -> None:
    hybrid = HybridTorchOpenCLAccelerator(TorchAccelerator(torch_module=FakeTorch(), device="cuda"))
    rgb = sample_rgb()
    src = rgb.astype(np.float32) / 255.0
    table = np.zeros((2, 2, 2, 3), dtype=np.float32)
    table[1, 1, 1] = 1.0
    info = hybrid.info("auto")

    assert hybrid.resize_area(rgb, (8, 8)).shape == (8, 8, 3)
    assert hybrid.apply_3d_lut(src, table, 0.5).shape == src.shape
    assert info.active_backend == "hybrid-opencl-cuda"
    assert set(info.gpu_ops) == {"resize", "rgb-lab", "lab-rgb", "curve-lut", "matrix", "histogram", "3d-lut"}
    assert info.cpu_fallback_ops == ()


def test_torch_accelerator_matches_cpu_3d_lut_when_torch_device_exists() -> None:
    torch = pytest.importorskip("torch")
    device = None
    if torch.cuda.is_available():
        device = "cuda"
    elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        device = "mps"
    if device is None:
        pytest.skip("Torch is installed, but no CUDA/MPS device is available")

    cpu = ImageAccelerator()
    torch_acc = TorchAccelerator(torch_module=torch, device=device)
    src = sample_rgb().astype(np.float32) / 255.0
    table = np.zeros((5, 5, 5, 3), dtype=np.float32)
    axis = np.linspace(0, 1, 5, dtype=np.float32)
    r, g, b = np.meshgrid(axis, axis, axis, indexing="ij")
    table[:, :, :, 0] = np.clip(r * 0.9 + 0.05, 0, 1)
    table[:, :, :, 1] = g
    table[:, :, :, 2] = np.clip(b * 1.05, 0, 1)

    expected = cpu.apply_3d_lut(src, table, 0.75)
    actual = torch_acc.apply_3d_lut(src, table, 0.75)

    assert np.allclose(actual, expected, atol=1e-5)
