"""Low-overhead performance instrumentation for backend operations.

The monitor deliberately records bounded, aggregate metadata only.  It does
not retain request payloads, image paths, or image data, so it is safe to keep
enabled in the local desktop backend while still being useful when a latency
regression needs to be diagnosed.
"""

from __future__ import annotations

from collections import deque
from contextlib import contextmanager
from dataclasses import asdict, dataclass
import os
from threading import Lock
import time
from typing import Callable, Iterator, Mapping, TypeVar


_NumberT = TypeVar("_NumberT", int, float)


@dataclass(frozen=True)
class PerformanceEvent:
    operation: str
    elapsed_ms: float
    status: str
    timestamp: float
    attributes: dict[str, str]


@dataclass
class _OperationStats:
    count: int = 0
    error_count: int = 0
    anomaly_count: int = 0
    total_ms: float = 0.0
    max_ms: float = 0.0
    last_ms: float = 0.0

    def record(self, event: PerformanceEvent, *, anomalous: bool) -> None:
        self.count += 1
        self.error_count += event.status != "ok"
        self.anomaly_count += anomalous
        self.total_ms += event.elapsed_ms
        self.max_ms = max(self.max_ms, event.elapsed_ms)
        self.last_ms = event.elapsed_ms

    def snapshot(self) -> dict[str, int | float]:
        average = self.total_ms / self.count if self.count else 0.0
        return {
            "count": self.count,
            "error_count": self.error_count,
            "anomaly_count": self.anomaly_count,
            "average_ms": round(average, 2),
            "max_ms": round(self.max_ms, 2),
            "last_ms": round(self.last_ms, 2),
        }


class PerformanceMonitor:
    """Thread-safe timing sink with bounded anomaly history.

    ``span`` is the intended instrumentation point.  Callers may also use
    ``record`` when an existing timer already provides an elapsed duration.
    """

    def __init__(
        self,
        *,
        enabled: bool = True,
        anomaly_threshold_ms: float = 750.0,
        buffer_limit: int = 80,
        clock: Callable[[], float] = time.perf_counter,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self.enabled = enabled
        self.anomaly_threshold_ms = max(0.0, float(anomaly_threshold_ms))
        self.buffer_limit = max(1, int(buffer_limit))
        self._clock = clock
        self._wall_clock = wall_clock
        self._lock = Lock()
        self._stats: dict[str, _OperationStats] = {}
        self._recent_anomalies: deque[PerformanceEvent] = deque(maxlen=self.buffer_limit)
        self._total_events = 0
        self._total_anomalies = 0

    @contextmanager
    def span(
        self,
        operation: str,
        *,
        attributes: Mapping[str, object] | None = None,
    ) -> Iterator[None]:
        if not self.enabled:
            yield
            return
        started = self._clock()
        try:
            yield
        except Exception:
            self.record(
                operation,
                (self._clock() - started) * 1000.0,
                status="error",
                attributes=attributes,
            )
            raise
        else:
            self.record(
                operation,
                (self._clock() - started) * 1000.0,
                attributes=attributes,
            )

    def record(
        self,
        operation: str,
        elapsed_ms: float,
        *,
        status: str = "ok",
        attributes: Mapping[str, object] | None = None,
    ) -> None:
        if not self.enabled:
            return
        event = PerformanceEvent(
            operation=str(operation),
            elapsed_ms=max(0.0, float(elapsed_ms)),
            status=str(status),
            timestamp=self._wall_clock(),
            attributes={str(key): str(value) for key, value in (attributes or {}).items()},
        )
        anomalous = event.elapsed_ms >= self.anomaly_threshold_ms
        with self._lock:
            stats = self._stats.setdefault(event.operation, _OperationStats())
            stats.record(event, anomalous=anomalous)
            self._total_events += 1
            if anomalous:
                self._total_anomalies += 1
                self._recent_anomalies.append(event)

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            operations = {
                name: stats.snapshot()
                for name, stats in sorted(self._stats.items())
            }
            anomalies = [
                {
                    **asdict(event),
                    "elapsed_ms": round(event.elapsed_ms, 2),
                }
                for event in self._recent_anomalies
            ]
            return {
                "enabled": self.enabled,
                "anomaly_threshold_ms": self.anomaly_threshold_ms,
                "buffer_limit": self.buffer_limit,
                "total_events": self._total_events,
                "total_anomalies": self._total_anomalies,
                "operations": operations,
                "recent_anomalies": anomalies,
            }

    def reset(self) -> None:
        with self._lock:
            self._stats.clear()
            self._recent_anomalies.clear()
            self._total_events = 0
            self._total_anomalies = 0


def monitor_from_environment() -> PerformanceMonitor:
    enabled = os.environ.get("PHOTO_CALIBRATOR_PERF_MONITOR", "1") != "0"
    threshold = _environment_number("PHOTO_CALIBRATOR_PERF_THRESHOLD_MS", 750.0, float)
    buffer_limit = _environment_number("PHOTO_CALIBRATOR_PERF_BUFFER_LIMIT", 80, int)
    return PerformanceMonitor(
        enabled=enabled,
        anomaly_threshold_ms=threshold,
        buffer_limit=buffer_limit,
    )


def _environment_number(
    name: str,
    default: _NumberT,
    converter: Callable[[str], _NumberT],
) -> _NumberT:
    try:
        return converter(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


PERFORMANCE_MONITOR = monitor_from_environment()


__all__ = [
    "PERFORMANCE_MONITOR",
    "PerformanceEvent",
    "PerformanceMonitor",
    "monitor_from_environment",
]
