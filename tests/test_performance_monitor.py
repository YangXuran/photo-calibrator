from __future__ import annotations

import pytest

from photo_calibrator.backend import simple_server
from photo_calibrator.backend.performance import PerformanceMonitor, monitor_from_environment


class FakeClock:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        return self.value

    def advance_ms(self, milliseconds: float) -> None:
        self.value += milliseconds / 1000.0


def test_monitor_records_aggregate_and_bounded_anomalies() -> None:
    clock = FakeClock()
    monitor = PerformanceMonitor(
        anomaly_threshold_ms=10,
        buffer_limit=2,
        clock=clock,
        wall_clock=lambda: 123.0,
    )

    for elapsed in (5, 12, 15, 20):
        with monitor.span("POST /api/calibrate"):
            clock.advance_ms(elapsed)

    snapshot = monitor.snapshot()
    operation = snapshot["operations"]["POST /api/calibrate"]
    assert operation == {
        "count": 4,
        "error_count": 0,
        "anomaly_count": 3,
        "average_ms": 13.0,
        "max_ms": 20.0,
        "last_ms": 20.0,
    }
    assert snapshot["total_events"] == 4
    assert snapshot["total_anomalies"] == 3
    assert [item["elapsed_ms"] for item in snapshot["recent_anomalies"]] == [15.0, 20.0]


def test_monitor_records_errors_without_swallowing_exception() -> None:
    clock = FakeClock()
    monitor = PerformanceMonitor(anomaly_threshold_ms=100, clock=clock)

    with pytest.raises(RuntimeError, match="boom"):
        with monitor.span("GET /api/failing"):
            clock.advance_ms(3)
            raise RuntimeError("boom")

    stats = monitor.snapshot()["operations"]["GET /api/failing"]
    assert stats["count"] == 1
    assert stats["error_count"] == 1
    assert stats["last_ms"] == 3.0


def test_disabled_monitor_is_a_noop_and_reset_clears_state() -> None:
    monitor = PerformanceMonitor(enabled=False)
    with monitor.span("GET /api/health"):
        pass
    assert monitor.snapshot()["total_events"] == 0

    enabled = PerformanceMonitor()
    enabled.record("GET /api/health", 1.0)
    enabled.reset()
    assert enabled.snapshot()["operations"] == {}


def test_backend_dispatch_is_the_shared_api_instrumentation_point(monkeypatch) -> None:
    monitor = PerformanceMonitor(anomaly_threshold_ms=10_000)
    monkeypatch.setattr(simple_server, "PERFORMANCE_MONITOR", monitor)

    health = simple_server.dispatch_backend_request("GET", "/api/health")
    assert health == {"ok": True, "service": "photo-calibrator", "api_version": 1}
    snapshot = simple_server.dispatch_backend_request("GET", "/api/performance")

    assert snapshot["operations"]["GET /api/health"]["count"] == 1
    assert "GET /api/performance" not in snapshot["operations"]

    assert simple_server.dispatch_backend_request("POST", "/api/performance/reset") == {"ok": True}
    assert monitor.snapshot()["operations"]["POST /api/performance/reset"]["count"] == 1


def test_invalid_environment_values_fall_back_to_safe_defaults(monkeypatch) -> None:
    monkeypatch.setenv("PHOTO_CALIBRATOR_PERF_THRESHOLD_MS", "invalid")
    monkeypatch.setenv("PHOTO_CALIBRATOR_PERF_BUFFER_LIMIT", "invalid")

    monitor = monitor_from_environment()

    assert monitor.anomaly_threshold_ms == 750.0
    assert monitor.buffer_limit == 80
