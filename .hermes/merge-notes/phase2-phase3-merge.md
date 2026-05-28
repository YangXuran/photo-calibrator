# Merge Notes: Phase 2 + Phase 3 (Agent B/D + OCIO/OIIO)

> 目标分支: `dev-codex`  
> 合入顺序: `phase2-image-io` → `dev-codex`, 然后 `phase3-backend-pipeline` → `dev-codex`

---

## 总体变更

| | Phase 2 (image-io) | Phase 3 (backend-pipeline) |
|---|---|---|
| Branch | `phase2-image-io` | `phase3-backend-pipeline` |
| Base | `dev-codex` | `phase2-image-io` |
| Commits | 6 | 6 |
| Files | 14 files, +900/-60 | 14 files, +1263/-75 |
| Tests | 84→84 passed | 84→122 passed |

---

## Phase 2: Image I/O / HDR / 导出 (Agent B)

### 文件变更

| Action | File |
|--------|------|
| Create | `src/photo_calibrator/io/__init__.py` |
| Create | `src/photo_calibrator/io/readers.py` |
| Create | `src/photo_calibrator/io/writers.py` |
| Create | `src/photo_calibrator/io/raw.py` |
| Create | `src/photo_calibrator/io/metadata.py` |
| Create | `src/photo_calibrator/io/sidecar.py` |
| Create | `src/photo_calibrator/io/lut_export.py` |
| Create | `tests/test_image_io.py` |
| Delete | `src/photo_calibrator/io.py` (→ package) |
| Modify | `src/photo_calibrator/core/image_model.py` |
| Modify | `src/photo_calibrator/backend/simple_server.py` |
| Modify | `tests/test_simple_server_api.py` |
| Modify | `tests/test_cast_detection.py` |
| Modify | `pyproject.toml` |

### 关键变更

1. **ImageBuffer 升级**: float32/uint16 → 自动检测 bit_depth/data_range，新增 `is_hdr`/`icc_profile`/`dtype`
2. **io/ 包**: readers.py (read_image → ImageBuffer), writers.py (export_jpeg/png/tiff16), raw.py (rawpy 解码), metadata.py (ICC/EXIF), sidecar.py (JSON), lut_export.py (.cube LUT)
3. **read_image()**: imageio 优先 → cv2 fallback, HDR/EXR 检测
4. **export**: JPEG/PNG/16-bit TIFF 导出，含 dtype 自动缩放
5. **RAW decode**: 从 simple_server 提取到 `io/raw.py`
6. **POST /api/export**: jpeg/png/tiff16/sidecar/cube
7. **依赖**: pillow (core), imageio + tifffile (optional io group)

---

## Phase 3: Backend API / Pipeline / OCIO+OIIO (Agent D)

### 文件变更

| Action | File |
|--------|------|
| Create | `src/photo_calibrator/backend/schemas.py` |
| Create | `src/photo_calibrator/pipeline/__init__.py` |
| Create | `src/photo_calibrator/pipeline/document.py` |
| Create | `src/photo_calibrator/pipeline/operations.py` |
| Create | `src/photo_calibrator/io/ocio.py` |
| Create | `src/photo_calibrator/io/oiio.py` |
| Create | `tests/test_schemas.py` |
| Create | `tests/test_pipeline.py` |
| Create | `tests/test_oiio_ocio.py` |
| Modify | `src/photo_calibrator/backend/simple_server.py` |
| Modify | `src/photo_calibrator/io/readers.py` |
| Modify | `tests/test_simple_server_api.py` |
| Modify | `tests/test_image_io.py` |
| Modify | `pyproject.toml` |

### 关键变更

1. **schemas.py**: PreparedImage/AnalysisEntry + 10 请求模型，simple_server 删除本地定义改为 import
2. **Session TTL**: `SESSION_TTL_SECONDS=3600`, `_get_analysis()` 超时自动回收
3. **Cache API**: `GET /api/cache/stats` + `POST /api/cache/clear`
4. **Sidecar API**: `POST /api/sidecar/save` + `GET /api/sidecar/load?path=`
5. **Export-path**: `POST /api/export-path` — 本地文件路径→校准→导出
6. **Batch**: `GET /api/batch/status?batch_id=` + `POST /api/batch/cancel`
7. **路由重构**: do_POST/do_GET 从 if/elif → dispatch dict (`_POST_ROUTES`/`_GET_ROUTES`)
8. **pipeline/ 模块**: Operation (abstract) → LabShiftOp/RgbCurvesOp/MatrixOp/Lut3DOp/IdentityOp → PipelineDocument (undo/redo/render_up_to)
9. **OCIO**: `io/ocio.py` — sRGB↔scene-linear via PyOpenColorIO + NumPy fallback
10. **OIIO**: `io/oiio.py` — EXR/HDR 读写，已集成到 `read_image()` (HDR 扩展名→OIIO→ImageBuffer)
11. **import 清理**: simple_server 删除未使用的 `dataclass` 和 `tempfile` import

### 新增 API 端点 (9 个)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cache/stats` | Cache statistics |
| POST | `/api/cache/clear` | Clear cache |
| POST | `/api/sidecar/save` | Save sidecar JSON |
| GET | `/api/sidecar/load?path=` | Load sidecar JSON |
| POST | `/api/export-path` | File-to-file export |
| GET | `/api/batch/status?batch_id=` | Batch progress |
| POST | `/api/batch/cancel` | Cancel batch |

### 系统依赖（新增）

```bash
# OCIO (color management)
sudo dnf install -y OpenColorIO

# OIIO (advanced I/O, EXR/HDR)
sudo dnf install -y python3-openimageio OpenImageIO-utils
```

---

## 覆盖率

```
Name                          Stmts   Miss Branch BrPart  Cover
---------------------------------------------------------------
core/calibration.py             296      7     60      5    97%
core/cast_detection.py          205      5     42      5    96%
core/image_model.py              59      5     22      3    88%
core/accelerator.py             359     51     40      9    81%
backend/schemas.py               78      0      0      0   100%
pipeline/document.py             32      0      4      0   100%
backend/simple_server.py        588    121    150     37    75%
pipeline/operations.py           47     12      0      0    74%
io/ocio.py                       62     18      4      2    70%
io/oiio.py                       81     23     34     14    66%
---------------------------------------------------------------
TOTAL                          2091    343    442     90    79%
```

低覆盖区域：raw.py(42%) — 需 rawpy libraw; readers/writers(45%) — 多 dtype/通道 fallback; ocio.py(70%) — OCIO CPU 路径需 `$OCIO` 环境变量。

---

## 合入检查清单

- [x] 全量测试 122/122 passed, 1 skipped (GPU Torch 未装)
- [x] compileall clean
- [x] 无 accelerator 内部改动
- [x] 无 calibration 算法改动
- [x] 无前端 UI 改动
- [x] 已有 API 响应字段未被删除/重命名
- [x] `io.py` → `io/` 包向后兼容 (`from photo_calibrator.io import load_rgb_image` 仍有效)
- [ ] RAW 解码真机验证: Sony A7M4 ARW 端到端通过 (DSC08739.ARW)
- [ ] GPU 验证: OpenCL RTX 5070 Ti 通过 (Torch CUDA 因下载超大未装)
- [ ] OIIO python3-openimageio 需系统包
- [ ] OCIO 需系统包 + `$OCIO` 环境变量指向 config.ocio
