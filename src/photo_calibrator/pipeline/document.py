"""Non-destructive pipeline document — ordered operation graph with history."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np

from .operations import Operation


@dataclass
class HistoryEntry:
    """A point-in-time snapshot of the operation stack."""

    description: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    operation_count: int = 0
    current_op_name: str = ""


@dataclass
class PipelineDocument:
    """Non-destructive editing graph: source image + ordered operations.

    Supports undo/redo via history snapshots, partial rendering for preview,
    and full replay for export.
    """

    source_image: np.ndarray
    operations: list[Operation] = field(default_factory=list)
    _history: list[list[Operation]] = field(default_factory=list)
    _history_meta: list[HistoryEntry] = field(default_factory=list)
    _history_index: int = -1

    # ── snapshot management ────────────────────────────────────────────

    def snapshot(self, description: str = "") -> None:
        """Save the current operation stack as a history checkpoint.

        Discards any future (redo) history after the current position.
        """
        op_name = self.operations[-1].name if self.operations else "no-op"
        entry = HistoryEntry(
            description=description or op_name,
            operation_count=len(self.operations),
            current_op_name=op_name,
        )
        # Truncate any redo history beyond current index
        self._history = self._history[: self._history_index + 1]
        self._history_meta = self._history_meta[: self._history_index + 1]
        # Save deep copy of current operations
        self._history.append(deepcopy(self.operations))
        self._history_meta.append(entry)
        self._history_index = len(self._history) - 1

    def undo(self) -> list[Operation] | None:
        """Revert to the previous history state.

        Returns the restored operation list, or None if no undo available.
        """
        if self._history_index <= 0:
            return None
        self._history_index -= 1
        self.operations = deepcopy(self._history[self._history_index])
        return self.operations

    def redo(self) -> list[Operation] | None:
        """Advance to the next history state.

        Returns the restored operation list, or None if no redo available.
        """
        if self._history_index >= len(self._history) - 1:
            return None
        self._history_index += 1
        self.operations = deepcopy(self._history[self._history_index])
        return self.operations

    def get_history(self) -> list[HistoryEntry]:
        """Return metadata for all history entries (for UI display)."""
        return list(self._history_meta)

    @property
    def can_undo(self) -> bool:
        return self._history_index > 0

    @property
    def can_redo(self) -> bool:
        return self._history_index < len(self._history) - 1

    @property
    def history_depth(self) -> int:
        return len(self._history)

    # ── operation management ───────────────────────────────────────────

    def add_op(self, op: Operation) -> None:
        """Append an operation and auto-snapshot."""
        self.operations.append(op)
        self.snapshot()

    def insert_op(self, index: int, op: Operation) -> None:
        """Insert an operation at a specific position and auto-snapshot."""
        self.operations.insert(index, op)
        self.snapshot()

    def remove_op(self, index: int) -> Operation:
        """Remove and return the operation at index, auto-snapshot."""
        removed = self.operations.pop(index)
        self.snapshot()
        return removed

    def render(self) -> np.ndarray:
        """Apply all operations in order to produce the output image."""
        img = self.source_image
        for op in self.operations:
            img = op.apply(img)
        return img

    def render_up_to(self, index: int) -> np.ndarray:
        """Render the pipeline up to and including operation at index."""
        img = self.source_image
        for op in self.operations[: index + 1]:
            img = op.apply(img)
        return img

    def clear(self) -> None:
        """Remove all operations, reset to source image."""
        self.operations.clear()
        self._history.clear()
        self._history_meta.clear()
        self._history_index = -1

    @property
    def op_count(self) -> int:
        return len(self.operations)

    @property
    def is_empty(self) -> bool:
        return len(self.operations) == 0
