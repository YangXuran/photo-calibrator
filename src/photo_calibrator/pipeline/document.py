"""Non-destructive pipeline document — ordered operation graph."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .operations import Operation


@dataclass
class PipelineDocument:
    """Non-destructive editing graph: source image + ordered operations.

    Supports undo (remove_op), redo (add_op at specific index),
    and partial rendering for preview.
    """

    source_image: np.ndarray
    operations: list[Operation] = field(default_factory=list)

    def add_op(self, op: Operation) -> None:
        """Append an operation to the end of the pipeline."""
        self.operations.append(op)

    def insert_op(self, index: int, op: Operation) -> None:
        """Insert an operation at a specific position."""
        self.operations.insert(index, op)

    def remove_op(self, index: int) -> Operation:
        """Remove and return the operation at index."""
        return self.operations.pop(index)

    def render(self) -> np.ndarray:
        """Apply all operations in order to produce the output image."""
        img = self.source_image
        for op in self.operations:
            img = op.apply(img)
        return img

    def render_up_to(self, index: int) -> np.ndarray:
        """Render the pipeline up to and including operation at index.

        Useful for preview during undo/redo navigation.
        """
        img = self.source_image
        for op in self.operations[:index + 1]:
            img = op.apply(img)
        return img

    def clear(self) -> None:
        """Remove all operations, reset to source image."""
        self.operations.clear()

    @property
    def op_count(self) -> int:
        return len(self.operations)

    @property
    def is_empty(self) -> bool:
        return len(self.operations) == 0
