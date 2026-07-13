from __future__ import annotations

import pytest

from photo_calibrator.services import _call_with_supported_kwargs
from photo_calibrator.backend.simple_server import _is_path_within


def test_supported_kwargs_preserves_legacy_hook_signature() -> None:
    def legacy(image, params):
        return image, params

    assert _call_with_supported_kwargs(
        legacy,
        "image",
        {"strength": 0.5},
        session_id="ignored-for-legacy",
    ) == ("image", {"strength": 0.5})


def test_supported_kwargs_passes_declared_and_variadic_context() -> None:
    def declared(image, params, *, session_id=None):
        return session_id

    def variadic(image, params, **kwargs):
        return kwargs

    assert _call_with_supported_kwargs(declared, None, {}, session_id="abc", analysis={}) == "abc"
    assert _call_with_supported_kwargs(variadic, None, {}, session_id="abc") == {"session_id": "abc"}


def test_supported_kwargs_does_not_hide_plugin_type_error() -> None:
    calls = 0

    def broken(image, params, **kwargs):
        nonlocal calls
        calls += 1
        raise TypeError("plugin bug")

    with pytest.raises(TypeError, match="plugin bug"):
        _call_with_supported_kwargs(broken, None, {}, session_id="abc")
    assert calls == 1


def test_path_boundary_rejects_sibling_with_same_prefix(tmp_path) -> None:
    root = tmp_path / "previews"
    sibling = tmp_path / "previews-private" / "secret.jpg"

    assert _is_path_within(root / "image.jpg", root)
    assert not _is_path_within(sibling, root)
