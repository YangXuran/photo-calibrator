"""Tests for pipeline module — Operation nodes and PipelineDocument."""

from __future__ import annotations

import numpy as np

from photo_calibrator.pipeline.document import PipelineDocument
from photo_calibrator.core.calibration import calibrate_negative_film
from photo_calibrator.pipeline.operations import CalibrationOp, IdentityOp, LabShiftOp, LookAdjustmentOp, NegativeFilmBaseOp, NegativeFilmRefineOp


def test_identity_op_returns_same_image() -> None:
    img = np.zeros((16, 16, 3), dtype=np.uint8)
    img[:, :] = 128
    op = IdentityOp()
    result = op.apply(img)
    assert np.array_equal(result, img)


def test_lab_shift_op_returns_correct_shape() -> None:
    img = np.zeros((16, 16, 3), dtype=np.uint8)
    img[4:12, 4:12] = (200, 150, 100)
    op = LabShiftOp(params={"a_shift": 2.0, "b_shift": -3.0, "strength": 1.0})
    result = op.apply(img)
    assert result.shape == img.shape
    assert result.dtype == np.uint8


def test_lab_shift_with_zero_strength_is_near_identity() -> None:
    """With strength=0, result should be nearly identical (float rounding from RGB/Lab conversion)."""
    img = np.zeros((16, 16, 3), dtype=np.uint8)
    img[:, :] = 128
    op = LabShiftOp(params={"a_shift": 10.0, "b_shift": 10.0, "strength": 0.0})
    result = op.apply(img)
    assert result.shape == img.shape
    assert result.dtype == np.uint8
    assert np.allclose(result.astype(float), img.astype(float), atol=2)


def test_pipeline_document_applies_ops_in_order() -> None:
    img = np.zeros((16, 16, 3), dtype=np.uint8)
    img[:, :] = 128
    doc = PipelineDocument(source_image=img)
    doc.add_op(IdentityOp())
    doc.add_op(IdentityOp())
    result = doc.render()
    assert np.array_equal(result, img)


def test_pipeline_document_undo_redo() -> None:
    img = np.zeros((16, 16, 3), dtype=np.uint8)
    doc = PipelineDocument(source_image=img)
    doc.add_op(IdentityOp())
    doc.add_op(LabShiftOp(params={"a_shift": 0, "b_shift": 0, "strength": 0}))
    assert doc.op_count == 2
    removed = doc.remove_op(0)
    assert doc.op_count == 1
    assert isinstance(removed, IdentityOp)
    doc.insert_op(0, IdentityOp())
    assert doc.op_count == 2


def test_pipeline_document_render_up_to() -> None:
    img = np.zeros((32, 32, 3), dtype=np.uint8)
    img[:, :] = 128
    doc = PipelineDocument(source_image=img)
    doc.add_op(IdentityOp())
    doc.add_op(LabShiftOp(params={"a_shift": 5.0, "b_shift": 0, "strength": 0.5}))
    result = doc.render_up_to(0)
    assert np.array_equal(result, img)


def test_pipeline_document_clear() -> None:
    img = np.zeros((16, 16, 3), dtype=np.uint8)
    doc = PipelineDocument(source_image=img)
    doc.add_op(IdentityOp())
    doc.add_op(IdentityOp())
    doc.clear()
    assert doc.op_count == 0
    assert doc.is_empty


def test_calibration_op_replays_current_backend_mode() -> None:
    img = np.zeros((24, 24, 3), dtype=np.uint8)
    img[:, :] = (160, 120, 90)
    op = CalibrationOp(params={"mode": "rgb-curves", "strength": 0.4})
    result = op.apply(img)
    assert result.shape == img.shape
    assert result.dtype == np.uint8


def test_look_adjustment_op_changes_color_without_shape_change() -> None:
    img = np.zeros((24, 24, 3), dtype=np.uint8)
    img[:, :] = (128, 128, 128)
    op = LookAdjustmentOp(params={"lab_bias": {"a": 12, "b": -8}})
    result = op.apply(img)
    assert result.shape == img.shape
    assert result.dtype == np.uint8
    assert not np.array_equal(result, img)


def test_negative_film_pipeline_nodes_match_composite_mode() -> None:
    x = np.linspace(20, 235, 48, dtype=np.uint8)
    xx, yy = np.meshgrid(x, x)
    positive = np.stack([xx, yy, ((xx.astype(int) + yy.astype(int)) // 2).astype(np.uint8)], axis=2)
    negative = 255 - positive
    doc = PipelineDocument(source_image=negative)
    doc.add_op(NegativeFilmBaseOp())
    doc.add_op(NegativeFilmRefineOp(params={"strength": 0.8}))

    rendered = doc.render()
    composite = calibrate_negative_film(negative, strength=0.8)

    assert rendered.shape == negative.shape
    assert rendered.dtype == np.uint8
    assert np.mean(np.abs(rendered.astype(np.float32) - composite.astype(np.float32))) < 1.0
