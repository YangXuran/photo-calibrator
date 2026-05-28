from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np

from photo_calibrator.core.accelerator import ACCELERATOR, accelerator_payload, benchmark_accelerator, set_accelerator_backend
from photo_calibrator.core.calibration import (
    CalibrationMode,
    CalibrationParams,
    calibrate_image,
    calibrate_image_from_analysis,
)
from photo_calibrator.core.cast_detection import analyze_image_array, auto_detect_cast, detect_neutral_mask, rgb_to_lab_float
from photo_calibrator.backend.schemas import AnalysisEntry, PreparedImage

ROOT = Path(__file__).resolve().parents[3]
WEB_ROOT = ROOT / "web"
PREVIEW_CACHE_DIR = ROOT / ".cache" / "previews"
DEFAULT_ANALYSIS_MAX_SIDE = 1800
MEMORY_CACHE_LIMIT = 16
BATCH_WORKERS = max(1, min(4, os.cpu_count() or 1))

cv2.setUseOptimized(True)
try:
    cv2.setNumThreads(max(1, (os.cpu_count() or 2) - 1))
except Exception:
    pass


_ANALYSIS_CACHE: OrderedDict[str, AnalysisEntry] = OrderedDict()
_CACHE_LOCK = Lock()
_ANALYSIS_KEY_LOCKS: dict[str, Lock] = {}
SESSION_TTL_SECONDS = 3600  # 1 hour


def _remember_analysis(entry: AnalysisEntry) -> AnalysisEntry:
    with _CACHE_LOCK:
        _ANALYSIS_CACHE[entry.cache_key] = entry
        _ANALYSIS_CACHE.move_to_end(entry.cache_key)
        while len(_ANALYSIS_CACHE) > MEMORY_CACHE_LIMIT:
            evicted_key, _ = _ANALYSIS_CACHE.popitem(last=False)
            _ANALYSIS_KEY_LOCKS.pop(evicted_key, None)
    return entry


def _get_analysis(cache_key: str) -> AnalysisEntry | None:
    with _CACHE_LOCK:
        entry = _ANALYSIS_CACHE.get(cache_key)
        if entry is None:
            return None
        if time.time() - entry.created_at > SESSION_TTL_SECONDS:
            _ANALYSIS_CACHE.pop(cache_key, None)
            _ANALYSIS_KEY_LOCKS.pop(cache_key, None)
            return None
        _ANALYSIS_CACHE.move_to_end(cache_key)
        return entry


def _analysis_key_lock(cache_key: str) -> Lock:
    with _CACHE_LOCK:
        lock = _ANALYSIS_KEY_LOCKS.get(cache_key)
        if lock is None:
            lock = Lock()
            _ANALYSIS_KEY_LOCKS[cache_key] = lock
        return lock


def _build_analysis_entry(cache_key: str, prepare) -> AnalysisEntry:
    cached = _get_analysis(cache_key)
    if cached is not None:
        return cached

    lock = _analysis_key_lock(cache_key)
    with lock:
        cached = _get_analysis(cache_key)
        if cached is not None:
            return cached
        prepared = prepare()
        input_report = analyze_image_array(prepared.image)
        zones = auto_detect_cast(prepared.image)
        static_charts = _static_chart_payload(input_report, prepared.image)
        return _remember_analysis(
            AnalysisEntry(
                prepared=prepared,
                input_report=input_report,
                zones=zones,
                static_charts=static_charts,
                cache_key=cache_key,
                created_at=time.time(),
            )
        )


def _decode_data_url(data_url: str) -> np.ndarray:
    raw, _ = _data_url_bytes(data_url)
    bgr, _ = _decode_preview_bgr(raw, "", DEFAULT_ANALYSIS_MAX_SIDE)
    return ACCELERATOR.bgr_to_rgb(_normalize_bgr(bgr))


def _data_url_bytes(data_url: str) -> tuple[bytes, str]:
    if "," not in data_url:
        raise ValueError("image_data must be a data URL")
    header, payload = data_url.split(",", 1)
    return base64.b64decode(payload), header


def _uploaded_cache_key(raw: bytes, file_name: str, max_side: int) -> str:
    digest = hashlib.sha256(raw).hexdigest()
    return f"upload:{digest}:{Path(file_name).name.lower()}:{int(max_side)}"


def _file_cache_key(path: Path, max_side: int) -> str:
    return f"file:{_preview_cache_key(path, max_side)}"


def _analysis_entry_for_prepared(prepared: PreparedImage, cache_key: str) -> AnalysisEntry:
    return _build_analysis_entry(cache_key, lambda: prepared)


def _prepare_uploaded_analysis(
    data_url: str,
    file_name: str = "",
    max_side: int = DEFAULT_ANALYSIS_MAX_SIDE,
) -> AnalysisEntry:
    raw, _ = _data_url_bytes(data_url)
    cache_key = _uploaded_cache_key(raw, file_name, max_side)

    def prepare() -> PreparedImage:
        bgr, preview_source = _decode_preview_bgr(raw, file_name, max_side)
        return _prepare_bgr_for_analysis(bgr, preview_source, max_side)

    return _build_analysis_entry(cache_key, prepare)


def _prepare_file_analysis(file_path: str | Path, max_side: int = DEFAULT_ANALYSIS_MAX_SIDE) -> AnalysisEntry:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Input file does not exist: {path}")
    cache_key = _file_cache_key(path, max_side)
    return _build_analysis_entry(cache_key, lambda: _prepare_file_for_analysis(path, max_side))


def _prepare_image_for_analysis(data_url: str, max_side: int = DEFAULT_ANALYSIS_MAX_SIDE) -> PreparedImage:
    return _prepare_uploaded_image(data_url, "", max_side)


def _prepare_uploaded_image(
    data_url: str,
    file_name: str = "",
    max_side: int = DEFAULT_ANALYSIS_MAX_SIDE,
) -> PreparedImage:
    return _prepare_uploaded_analysis(data_url, file_name, max_side).prepared


def _prepare_file_for_analysis(file_path: str | Path, max_side: int = DEFAULT_ANALYSIS_MAX_SIDE) -> PreparedImage:
    path = Path(file_path)
    lower_name = path.name.lower()
    if not path.exists():
        raise FileNotFoundError(f"Input file does not exist: {path}")

    cached = _load_cached_preview(path, max_side)
    if cached is not None:
        return cached

    if lower_name.endswith((".tif", ".tiff")):
        bgr, source = _decode_tiff_file_preview(path, max_side)
        prepared = _prepare_bgr_for_analysis(bgr, source, max_side, source_size=_image_size_hint(path))
        _write_cached_preview(path, max_side, prepared)
        return prepared

    if lower_name.endswith((".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".rw2", ".orf", ".pef", ".srw")):
        raw = path.read_bytes()
        bgr_source = _try_decode_raw_preview(raw, path.name)
        if bgr_source is None:
            raise ValueError("Unsupported RAW file")
        bgr, source = bgr_source
        prepared = _prepare_bgr_for_analysis(bgr, source, max_side)
        _write_cached_preview(path, max_side, prepared)
        return prepared

    flag = _reduced_imread_flag_for_path(path, max_side)
    bgr = cv2.imread(str(path), flag)
    if bgr is None:
        raise ValueError(f"Unsupported or corrupt image file: {path}")
    prepared = _prepare_bgr_for_analysis(
        bgr,
        "opencv-file-reduced" if flag != cv2.IMREAD_COLOR else "opencv-file",
        max_side,
        source_size=_image_size_hint(path),
    )
    _write_cached_preview(path, max_side, prepared)
    return prepared


def _preview_cache_key(path: Path, max_side: int) -> str:
    stat = path.stat()
    payload = {
        "path": str(path.resolve()),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "max_side": int(max_side),
        "version": 1,
    }
    raw = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:32]


def _preview_cache_paths(path: Path, max_side: int) -> tuple[Path, Path]:
    key = _preview_cache_key(path, max_side)
    return PREVIEW_CACHE_DIR / f"{key}.jpg", PREVIEW_CACHE_DIR / f"{key}.json"


def _load_cached_preview(path: Path, max_side: int) -> PreparedImage | None:
    image_path, meta_path = _preview_cache_paths(path, max_side)
    if not image_path.exists() or not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        return _prepare_bgr_for_analysis(
            bgr,
            "preview-cache",
            max_side,
            source_size=(int(meta["original_width"]), int(meta["original_height"])),
        )
    except Exception:
        return None


def _write_cached_preview(path: Path, max_side: int, prepared: PreparedImage) -> None:
    if prepared.preview_source in {"preview-cache", "raw-embedded-jpeg", "raw-embedded-bitmap", "tiff-pil-preview-page"}:
        return
    try:
        PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        image_path, meta_path = _preview_cache_paths(path, max_side)
        bgr = ACCELERATOR.rgb_to_bgr(prepared.image)
        ok = cv2.imwrite(str(image_path), bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            return
        meta = {
            "original_width": prepared.original_width,
            "original_height": prepared.original_height,
            "analysis_width": prepared.analysis_width,
            "analysis_height": prepared.analysis_height,
            "source_dtype": prepared.source_dtype,
            "preview_source": prepared.preview_source,
            "created_at": time.time(),
        }
        meta_path.write_text(json.dumps(meta, sort_keys=True), encoding="utf-8")
    except Exception:
        return


def _decode_tiff_file_preview(path: Path, max_side: int) -> tuple[np.ndarray, str]:
    try:
        from PIL import Image

        with Image.open(path) as image:
            frames = getattr(image, "n_frames", 1)
            if frames > 1:
                candidates: list[tuple[int, int, int]] = []
                for index in range(frames):
                    image.seek(index)
                    longest = max(image.size)
                    if longest >= 160:
                        candidates.append((longest, index, frames))
                if candidates:
                    candidates.sort(key=lambda item: item[0])
                    image.seek(candidates[0][1])
                    rgb = np.array(image.convert("RGB"))
                    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), "tiff-pil-preview-page"
    except Exception:
        pass

    flag = _reduced_imread_flag_for_path(path, max_side)
    bgr = cv2.imread(str(path), flag)
    if bgr is None:
        raise ValueError(f"Unsupported or corrupt TIFF file: {path}")
    return bgr, "tiff-reduced-decode" if flag != cv2.IMREAD_COLOR else "tiff-full-decode"


def _reduced_imread_flag_for_path(path: Path, max_side: int) -> int:
    size = _image_size_hint(path)
    if size is None:
        return cv2.IMREAD_COLOR
    longest = max(size)
    if longest / 8 >= max_side:
        return cv2.IMREAD_REDUCED_COLOR_8
    if longest / 4 >= max_side:
        return cv2.IMREAD_REDUCED_COLOR_4
    if longest / 2 >= max_side:
        return cv2.IMREAD_REDUCED_COLOR_2
    return cv2.IMREAD_COLOR


def _image_size_hint(path: Path) -> tuple[int, int] | None:
    try:
        from PIL import Image

        with Image.open(path) as image:
            return int(image.width), int(image.height)
    except Exception:
        return None


def _decode_preview_bgr(raw: bytes, file_name: str, max_side: int) -> tuple[np.ndarray, str]:
    arr = np.frombuffer(raw, dtype=np.uint8)
    lower_name = file_name.lower()

    if lower_name.endswith((".tif", ".tiff")):
        ok, pages = cv2.imdecodemulti(arr, cv2.IMREAD_UNCHANGED)
        if ok and pages:
            page = _choose_tiff_preview_page(pages, max_side)
            source = "tiff-preview-page" if len(pages) > 1 and page is not pages[0] else "tiff-full-page"
            return page, source

    bgr = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if bgr is not None:
        return bgr, "opencv-decode"

    raw_preview = _try_decode_raw_preview(raw, file_name)
    if raw_preview is not None:
        return raw_preview

    raise ValueError("Unsupported or corrupt image data")


def _prepare_bgr_for_analysis(
    bgr: np.ndarray,
    preview_source: str,
    max_side: int,
    source_size: tuple[int, int] | None = None,
) -> PreparedImage:
    source_dtype = str(bgr.dtype)
    if source_size:
        original_width, original_height = source_size
    else:
        original_height, original_width = int(bgr.shape[0]), int(bgr.shape[1])
    bgr = _normalize_bgr(bgr)
    rgb = ACCELERATOR.bgr_to_rgb(bgr)
    analysis = _resize_to_max_side(rgb, max_side)
    downsample_ratio = analysis.shape[1] / max(original_width, 1)
    return PreparedImage(
        image=analysis,
        original_width=original_width,
        original_height=original_height,
        analysis_width=int(analysis.shape[1]),
        analysis_height=int(analysis.shape[0]),
        downsample_ratio=float(downsample_ratio),
        source_dtype=source_dtype,
        preview_source=preview_source,
    )


def _resize_to_max_side(img_rgb: np.ndarray, max_side: int) -> np.ndarray:
    if max_side <= 0:
        return img_rgb
    h, w = img_rgb.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return img_rgb
    scale = max_side / float(longest)
    target = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    return ACCELERATOR.resize_area(img_rgb, target)


def _choose_tiff_preview_page(pages: list[np.ndarray], max_side: int) -> np.ndarray:
    if len(pages) == 1:
        return pages[0]
    min_usable_preview = 160
    ranked: list[tuple[int, int, np.ndarray]] = []
    for index, page in enumerate(pages):
        h, w = page.shape[:2]
        longest = max(h, w)
        if longest >= min_usable_preview:
            ranked.append((longest, index, page))
    if ranked:
        ranked.sort(key=lambda item: (item[0], item[1]))
        return ranked[0][2]
    return max(pages, key=lambda page: max(page.shape[:2]))


def _try_decode_raw_preview(raw: bytes, file_name: str) -> tuple[np.ndarray, str] | None:
    from photo_calibrator.io.raw import RAW_EXTENSIONS, decode_raw_preview

    if not file_name.lower().endswith(RAW_EXTENSIONS):
        return None
    return decode_raw_preview(raw, file_name)


def _normalize_bgr(bgr: np.ndarray) -> np.ndarray:
    if bgr.ndim == 2:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)
    if bgr.shape[2] == 4:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_BGRA2BGR)
    if bgr.dtype != np.uint8:
        bgr = _to_uint8_preview(bgr)
    return bgr


def _to_uint8_preview(img: np.ndarray) -> np.ndarray:
    if img.dtype == np.uint8:
        return img
    data = img.astype(np.float32)
    max_value = float(data.max()) if data.size else 0.0
    if np.issubdtype(img.dtype, np.integer):
        dtype_max = float(np.iinfo(img.dtype).max)
        if dtype_max > 0:
            data = data / dtype_max * 255.0
    elif max_value <= 1.0:
        data = data * 255.0
    else:
        data = data / max(max_value, 1.0) * 255.0
    return np.clip(data, 0, 255).astype(np.uint8)


def _encode_data_url(img_rgb: np.ndarray, ext: str = ".jpg", quality: int = 92) -> str:
    bgr = ACCELERATOR.rgb_to_bgr(img_rgb)
    params: list[int] = []
    mime = "image/jpeg"
    if ext == ".jpg":
        params = [cv2.IMWRITE_JPEG_QUALITY, quality]
    elif ext == ".png":
        mime = "image/png"
    ok, encoded = cv2.imencode(ext, bgr, params)
    if not ok:
        raise ValueError("Could not encode output image")
    payload = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:{mime};base64,{payload}"


def _report_payload(report) -> dict:
    return {
        "width": report.width,
        "height": report.height,
        "severity": report.severity,
        "direction": report.cast_direction,
        "lab": {
            "l": report.lab.l_mean,
            "a": report.lab.a_mean,
            "b": report.lab.b_star_mean,
            "strength": report.lab.cast_strength,
        },
        "rgb": {
            "r": report.rgb.r_mean,
            "g": report.rgb.g_mean,
            "b": report.rgb.b_mean,
            "spread": report.channel_spread,
        },
        "peaks": report.peaks,
        "peak_spread": report.peak_spread,
        "zones": {
            name: {"a": zone.a_mean, "b": zone.b_mean, "pixels": zone.pixels, "confidence": zone.confidence}
            for name, zone in report.zones.items()
        },
        "skin": (
            {"a": report.skin.a_mean, "b": report.skin.b_mean, "pixels": report.skin.pixels}
            if report.skin
            else None
        ),
    }


def _histogram_payload(img_rgb: np.ndarray, bins: int = 256) -> dict:
    histograms = {}
    for ch, name in [(0, "r"), (1, "g"), (2, "b")]:
        hist = ACCELERATOR.calc_hist(img_rgb, ch, bins)
        max_count = float(hist.max()) or 1.0
        histograms[name] = {
            "normalized": [float(v / max_count) for v in hist],
            "counts": [int(v) for v in hist],
            "peak_bin": int(np.argmax(hist)),
        }
    return {"bins": bins, "channels": histograms}


def _static_chart_payload(input_report, img_rgb: np.ndarray) -> dict:
    zone_order = ["shadow", "midtone", "highlight"]
    zones = []
    for name in zone_order:
        zone = input_report.zones.get(name)
        if zone:
            zones.append({"name": name, "a": zone.a_mean, "b": zone.b_mean, "pixels": zone.pixels})
    return {
        "rgb_histogram": _histogram_payload(img_rgb, bins=256),
        "ccc": _ccc_payload(img_rgb),
        "pci": _pci_payload(input_report),
        "neutral_mask": _neutral_mask_payload(img_rgb),
        "zones": zones,
        "input_lab_vector": {"name": "原图", "a": input_report.lab.a_mean, "b": input_report.lab.b_star_mean},
        "skin_lab_vector": (
            {"name": "肤色", "a": input_report.skin.a_mean, "b": input_report.skin.b_mean}
            if input_report.skin
            else None
        ),
    }


def _chart_payload(input_report, output_report, img_rgb: np.ndarray, static_charts: dict | None = None) -> dict:
    static = static_charts or _static_chart_payload(input_report, img_rgb)
    lab_vectors = [
        static["input_lab_vector"],
        {"name": "校准", "a": output_report.lab.a_mean, "b": output_report.lab.b_star_mean},
    ]
    if static.get("skin_lab_vector"):
        lab_vectors.append(static["skin_lab_vector"])
    return {
        "rgb_histogram": static["rgb_histogram"],
        "ccc": static["ccc"],
        "pci": static["pci"],
        "neutral_mask": static["neutral_mask"],
        "rgb_means": {
            "input": {
                "r": input_report.rgb.r_mean,
                "g": input_report.rgb.g_mean,
                "b": input_report.rgb.b_mean,
            },
            "output": {
                "r": output_report.rgb.r_mean,
                "g": output_report.rgb.g_mean,
                "b": output_report.rgb.b_mean,
            },
        },
        "lab_vectors": lab_vectors,
        "strengths": [
            {"name": "原图", "value": input_report.lab.cast_strength},
            {"name": "校准", "value": output_report.lab.cast_strength},
        ],
        "zones": static["zones"],
    }


def _ccc_payload(img_rgb: np.ndarray) -> dict:
    lab = rgb_to_lab_float(img_rgb)
    a_values = lab[:, :, 1].astype(np.float64)
    b_values = lab[:, :, 2].astype(np.float64)
    mu_a = float(a_values.mean())
    mu_b = float(b_values.mean())
    sigma_a = float(a_values.std())
    sigma_b = float(b_values.std())
    mu = float(np.sqrt(mu_a**2 + mu_b**2))
    sigma = float(np.sqrt(sigma_a**2 + sigma_b**2))
    distance = mu - sigma
    d_sigma = distance / sigma if sigma > 1e-9 else 0.0
    k = distance / mu if mu > 1e-9 else 0.0
    return {
        "mu_a": mu_a,
        "mu_b": mu_b,
        "sigma_a": sigma_a,
        "sigma_b": sigma_b,
        "mu": mu,
        "sigma": sigma,
        "distance": distance,
        "d_sigma": d_sigma,
        "k": k,
    }


def _pci_payload(report) -> dict:
    a_value = float(report.lab.a_mean)
    b_value = float(report.lab.b_star_mean)
    l_value = float(report.lab.l_mean)
    weighted = float(np.sqrt((a_value * 1.8) ** 2 + b_value**2))
    if l_value < 30:
        luminance_factor = 0.55
    elif l_value > 70:
        luminance_factor = 1.0
    else:
        luminance_factor = 0.55 + (l_value - 30) / 40 * 0.45
    pci = weighted * luminance_factor
    return {
        "weighted_delta": weighted,
        "luminance_factor": luminance_factor,
        "value": pci,
    }


def _neutral_mask_payload(img_rgb: np.ndarray) -> dict:
    mask = detect_neutral_mask(img_rgb)
    pixels = int(mask.sum())
    total = int(mask.size)
    return {
        "pixels": pixels,
        "total": total,
        "coverage": pixels / max(total, 1),
    }


def _accelerator_payload() -> dict:
    return accelerator_payload()


def _set_accelerator_payload(backend: str) -> dict:
    return set_accelerator_backend(backend)


def _accelerator_benchmark_payload(image_side: int = 256, lut_size: int = 17, iterations: int = 3) -> dict:
    return benchmark_accelerator(image_side=image_side, lut_size=lut_size, iterations=iterations)


def _calibrate_payload(body: dict) -> dict:
    start = time.perf_counter()
    entry = _prepare_uploaded_analysis(
        body["image_data"],
        file_name=str(body.get("file_name", "")),
        max_side=int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE)),
    )
    return _calibrate_entry_payload(entry, body, start)


def _calibrate_session_payload(body: dict) -> dict:
    start = time.perf_counter()
    entry = _get_analysis(str(body["session_id"]))
    if entry is None:
        raise ValueError("Unknown or expired session_id")
    return _calibrate_entry_payload(entry, body, start)


def _calibrate_entry_payload(entry: AnalysisEntry, body: dict, start: float) -> dict:
    img = entry.prepared.image
    mode = CalibrationMode(body.get("mode", CalibrationMode.GLOBAL.value))
    params = CalibrationParams(
        mode=mode,
        strength=float(body.get("strength", 0.8)),
        highlight_pct=float(body.get("highlight_pct", 55.0)),
        sat_pct=float(body.get("sat_pct", 25.0)),
    )
    result = calibrate_image_from_analysis(img, params, entry.input_report, entry.zones)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    include_original = bool(body.get("include_original", True))
    return _calibration_response(entry, result, img, elapsed_ms, include_original=include_original)


def _calibrate_path_payload(body: dict) -> dict:
    start = time.perf_counter()
    entry = _prepare_file_analysis(
        body["path"],
        max_side=int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE)),
    )
    return _calibrate_entry_payload(entry, body, start)


def _calibrate_paths_payload(body: dict) -> dict:
    paths = [str(path) for path in body.get("paths", [])]
    if not paths:
        raise ValueError("paths must contain at least one image path")
    max_side = int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE))
    workers = max(1, min(int(body.get("workers", BATCH_WORKERS)), BATCH_WORKERS, len(paths)))

    def one(path: str) -> dict:
        start = time.perf_counter()
        entry = _prepare_file_analysis(path, max_side=max_side)
        return _calibrate_entry_payload(entry, body | {"path": path}, start)

    results: list[dict | None] = [None] * len(paths)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {pool.submit(one, path): index for index, path in enumerate(paths)}
        for future in as_completed(future_map):
            index = future_map[future]
            try:
                results[index] = future.result()
            except Exception as exc:
                results[index] = {"path": paths[index], "error": str(exc)}
    return {"workers": workers, "results": results}


def _calibrate_batch_payload(body: dict) -> dict:
    items = list(body.get("items", []))
    if not items:
        raise ValueError("items must contain at least one uploaded image")
    max_side = int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE))
    workers = max(1, min(int(body.get("workers", BATCH_WORKERS)), BATCH_WORKERS, len(items)))

    def one(index: int, item: dict) -> dict:
        start = time.perf_counter()
        entry = _prepare_uploaded_analysis(
            item["image_data"],
            file_name=str(item.get("file_name", f"upload-{index}")),
            max_side=max_side,
        )
        request_body = body | item
        request_body.pop("items", None)
        return _calibrate_entry_payload(entry, request_body, start)

    results: list[dict | None] = [None] * len(items)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {pool.submit(one, index, item): index for index, item in enumerate(items)}
        for future in as_completed(future_map):
            index = future_map[future]
            try:
                results[index] = future.result()
            except Exception as exc:
                results[index] = {"file_name": str(items[index].get("file_name", f"upload-{index}")), "error": str(exc)}
    return {"workers": workers, "results": results}


def _calibration_response(
    entry: AnalysisEntry,
    result,
    img: np.ndarray,
    elapsed_ms: float,
    include_original: bool = True,
) -> dict:
    prepared = entry.prepared
    accelerator = _accelerator_payload()
    return {
        "session_id": entry.cache_key,
        "input": _report_payload(entry.input_report),
        "output": _report_payload(result.post_report),
        "mode": result.mode.value,
        "shift": {"a": result.a_shift, "b": result.b_shift},
        "reduction_pct": result.reduction_pct,
        "original_preview": _encode_data_url(img) if include_original else None,
        "calibrated_image": _encode_data_url(result.image),
        "charts": _chart_payload(entry.input_report, result.post_report, img, entry.static_charts),
        "processing": {
            "original_width": prepared.original_width,
            "original_height": prepared.original_height,
            "analysis_width": prepared.analysis_width,
            "analysis_height": prepared.analysis_height,
            "downsample_ratio": prepared.downsample_ratio,
            "source_dtype": prepared.source_dtype,
            "preview_source": prepared.preview_source,
            "elapsed_ms": elapsed_ms,
            "cache_key": entry.cache_key,
            "memory_cache_items": len(_ANALYSIS_CACHE),
            "opencv_threads": cv2.getNumThreads(),
            "accelerator_backend": accelerator["active_backend"],
            "accelerator_requested": accelerator["requested_backend"],
            "accelerated_ops": accelerator["accelerated_ops"],
            "cpu_fallback_ops": accelerator["cpu_fallback_ops"],
            "gpu_ops": accelerator["gpu_ops"],
            "fallback_reason": accelerator["fallback_reason"],
            "opencl_available": accelerator["opencl_available"],
            "opencl_enabled": accelerator["opencl_enabled"],
            "auto_cast_source": result.metadata.get("auto_cast_source", "global"),
            "auto_cast_confidence": result.metadata.get("auto_cast_confidence", 1.0),
        },
    }


def _export_payload(body: dict) -> dict:
    """Export calibrated image to disk file."""
    start = time.perf_counter()

    output_path = Path(body["output_path"]).resolve()
    fmt = body.get("format", "jpeg")

    entry = _prepare_uploaded_analysis(
        body["image_data"],
        file_name=str(body.get("file_name", "")),
    )
    img = entry.prepared.image
    mode = CalibrationMode(body.get("mode", CalibrationMode.GLOBAL.value))
    params = CalibrationParams(
        mode=mode,
        strength=float(body.get("strength", 0.8)),
        highlight_pct=float(body.get("highlight_pct", 55.0)),
        sat_pct=float(body.get("sat_pct", 25.0)),
    )
    result = calibrate_image_from_analysis(img, params, entry.input_report, entry.zones)

    from photo_calibrator.core.image_model import ImageBuffer
    from photo_calibrator.io.writers import write_image

    buf = ImageBuffer(data=result.image)

    if fmt in {"jpeg", "jpg", "png", "tiff16", "tif16"}:
        if fmt == "tiff16" or fmt == "tif16":
            output_path = output_path.with_suffix(".tif")
        write_image(buf, output_path, quality=int(body.get("quality", 92)))
    elif fmt == "sidecar":
        from photo_calibrator.io.sidecar import write_sidecar_json

        calib_params = {
            "mode": result.mode.value,
            "a_shift": result.a_shift,
            "b_shift": result.b_shift,
            "strength": result.params.strength,
        }
        write_sidecar_json(output_path, calib_params)
    elif fmt == "cube":
        from photo_calibrator.io.lut_export import write_cube_lut

        write_cube_lut(output_path, size=17)
    else:
        raise ValueError(f"Unsupported export format: {fmt}")

    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {
        "ok": True,
        "path": str(output_path),
        "format": fmt,
        "size": output_path.stat().st_size if output_path.exists() else 0,
        "elapsed_ms": elapsed_ms,
    }


def _cache_stats_payload() -> dict:
    """GET /api/cache/stats — cache statistics."""
    with _CACHE_LOCK:
        now = time.time()
        oldest = 0.0
        for entry in _ANALYSIS_CACHE.values():
            age = now - entry.created_at
            if oldest == 0.0 or age > oldest:
                oldest = age
        return {
            "items": len(_ANALYSIS_CACHE),
            "limit": MEMORY_CACHE_LIMIT,
            "ttl_seconds": SESSION_TTL_SECONDS,
            "oldest_age_seconds": oldest,
        }


def _cache_clear_payload() -> dict:
    """POST /api/cache/clear — clear all cached analysis entries."""
    with _CACHE_LOCK:
        count = len(_ANALYSIS_CACHE)
        _ANALYSIS_CACHE.clear()
        _ANALYSIS_KEY_LOCKS.clear()
    return {"ok": True, "cleared": count}


def _sidecar_save_payload(body: dict) -> dict:
    """POST /api/sidecar/save — write calibration sidecar JSON."""
    from photo_calibrator.io.sidecar import write_sidecar_json

    path = Path(body["path"])
    calib = body.get("calibration", {})
    version = body.get("algorithm_version", "0.2.0")
    metadata = body.get("input_metadata")
    write_sidecar_json(path, calib, algorithm_version=version, input_metadata=metadata)
    return {"ok": True, "path": str(path), "size": path.stat().st_size}


def _sidecar_load_payload(body: dict) -> dict:
    """GET /api/sidecar/load?path=... — read calibration sidecar JSON."""
    from photo_calibrator.io.sidecar import read_sidecar_json

    return read_sidecar_json(body["path"])


# ---------------------------------------------------------------------------
# Named handler functions for route dispatch (module-level)
# ---------------------------------------------------------------------------


def _handle_analyze(body: dict) -> dict:
    report = analyze_image_array(_decode_data_url(body["image_data"]))
    return {"input": _report_payload(report)}


def _get_capabilities_route(query: dict) -> dict:
    if "backend" in query:
        return {"accelerator": _set_accelerator_payload(query["backend"][0])}
    return {"accelerator": _accelerator_payload()}


def _get_benchmark_route(query: dict) -> dict:
    if "backend" in query:
        _set_accelerator_payload(query["backend"][0])
    return {"benchmark": _accelerator_benchmark_payload(
        image_side=int(query.get("image_side", ["256"])[0]),
        lut_size=int(query.get("lut_size", ["17"])[0]),
        iterations=int(query.get("iterations", ["3"])[0]),
    )}


# ---------------------------------------------------------------------------
# Route dispatch tables
# ---------------------------------------------------------------------------

_POST_ROUTES: dict[str, "Callable[[dict], dict]"] = {
    "/api/analyze": _handle_analyze,
    "/api/calibrate": _calibrate_payload,
    "/api/calibrate-session": _calibrate_session_payload,
    "/api/calibrate-batch": _calibrate_batch_payload,
    "/api/calibrate-path": _calibrate_path_payload,
    "/api/calibrate-paths": _calibrate_paths_payload,
    "/api/export": _export_payload,
    "/api/cache/clear": lambda _body: _cache_clear_payload(),
    "/api/sidecar/save": _sidecar_save_payload,
}

_GET_ROUTES: dict[str, "Callable[[dict], dict]"] = {
    "/api/health": lambda _query: {"ok": True},
    "/api/capabilities": _get_capabilities_route,
    "/api/accelerator-benchmark": _get_benchmark_route,
    "/api/cache/stats": lambda _query: _cache_stats_payload(),
    "/api/sidecar/load": lambda query: _sidecar_load_payload({"path": query["path"][0]}),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "PhotoCalibratorUI/0.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send_json(self, payload: dict, status: int = 200) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        content = path.read_bytes()
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            handler = _POST_ROUTES.get(self.path)
            if handler is None:
                self.send_error(404)
                return
            self._send_json(handler(body))
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=400)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        handler = _GET_ROUTES.get(parsed.path)
        if handler is not None:
            query = parse_qs(parsed.query)
            self._send_json(handler(query))
            return
        rel = "index.html" if parsed.path in {"/", ""} else parsed.path.lstrip("/")
        candidate = (WEB_ROOT / rel).resolve()
        if not str(candidate).startswith(str(WEB_ROOT.resolve())):
            self.send_error(403)
            return
        self._send_file(candidate)


def run(host: str = "127.0.0.1", port: int = 8765, accelerator: str = "auto") -> None:
    _set_accelerator_payload(accelerator)
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Photo Calibrator UI: http://{host}:{port} ({_accelerator_payload()['active_backend']})")
    httpd.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the lightweight Photo Calibrator web UI")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--accelerator",
        default="auto",
        choices=["auto", "cpu-opencv", "opencl", "opencl-umat", "torch", "torch-cuda", "torch-mps", "metal", "metal-mps"],
    )
    args = parser.parse_args()
    run(args.host, args.port, args.accelerator)


if __name__ == "__main__":
    main()
