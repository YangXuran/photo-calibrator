"""Workspace database — single SQLite file per project root.

Stores:
- Preview thumbnails (JPEG blobs) + metadata
- Saved sessions (calibration params, document ops, AI evals)
- Analysis cache (input reports, zones, static charts)
- File inventory (tracks source files for cache invalidation)

Location: ``{photo directory}/photo-calibrator.db`` for user workspaces.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

DB_FILENAME = "workspace.db"
DB_VERSION = 4

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS previews (
    cache_key        TEXT PRIMARY KEY,
    source_path      TEXT NOT NULL,
    image_blob       BLOB NOT NULL,
    original_width   INTEGER NOT NULL,
    original_height  INTEGER NOT NULL,
    analysis_width   INTEGER NOT NULL,
    analysis_height  INTEGER NOT NULL,
    source_dtype     TEXT NOT NULL,
    preview_source   TEXT NOT NULL,
    color_space      TEXT NOT NULL DEFAULT 'sRGB',
    data_range_json  TEXT,
    created_at       REAL NOT NULL,
    accessed_at      REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_previews_source_path ON previews(source_path);
CREATE INDEX IF NOT EXISTS idx_previews_accessed_at ON previews(accessed_at);

CREATE TABLE IF NOT EXISTS sessions (
    session_id           TEXT PRIMARY KEY,
    source_path          TEXT,
    session_data_json    TEXT NOT NULL,
    document_json        TEXT,
    ai_evaluations_json  TEXT,
    created_at           REAL NOT NULL,
    updated_at           REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_source_path ON sessions(source_path);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);

CREATE TABLE IF NOT EXISTS analysis_cache (
    cache_key            TEXT PRIMARY KEY,
    source_path          TEXT NOT NULL,
    input_report_json    TEXT NOT NULL,
    zones_json           TEXT NOT NULL,
    static_charts_json   TEXT NOT NULL,
    created_at           REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_cache_source ON analysis_cache(source_path);

CREATE TABLE IF NOT EXISTS file_inventory (
    source_path      TEXT PRIMARY KEY,
    file_size        INTEGER NOT NULL,
    mtime_ns         INTEGER NOT NULL,
    content_hash     TEXT NOT NULL,
    indexed_at       REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_inventory_indexed_at ON file_inventory(indexed_at);

CREATE TABLE IF NOT EXISTS action_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     TEXT NOT NULL,
    description    TEXT NOT NULL,
    action_type    TEXT NOT NULL DEFAULT 'calibration',
    params_json    TEXT,
    created_at     REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_action_history_session ON action_history(session_id);
CREATE INDEX IF NOT EXISTS idx_action_history_created ON action_history(created_at);
"""

_MIGRATIONS = {
    2: """
        CREATE TABLE IF NOT EXISTS action_history (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id     TEXT NOT NULL,
            description    TEXT NOT NULL,
            action_type    TEXT NOT NULL DEFAULT 'calibration',
            params_json    TEXT,
            created_at     REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_action_history_session ON action_history(session_id);
        CREATE INDEX IF NOT EXISTS idx_action_history_created ON action_history(created_at);
        """,
    3: """
        ALTER TABLE sessions ADD COLUMN history_cursor INTEGER NOT NULL DEFAULT -1;
        ALTER TABLE sessions ADD COLUMN calibrated_preview_blob BLOB;
        ALTER TABLE sessions ADD COLUMN calibrated_preview_mime TEXT;
        ALTER TABLE action_history ADD COLUMN sequence_no INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE action_history ADD COLUMN before_state_json TEXT;
        ALTER TABLE action_history ADD COLUMN after_state_json TEXT;
        UPDATE action_history
        SET sequence_no = (
            SELECT COUNT(*) - 1 FROM action_history AS previous
            WHERE previous.session_id = action_history.session_id
              AND previous.id <= action_history.id
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_action_history_sequence
            ON action_history(session_id, sequence_no);
        """,
    4: """
        ALTER TABLE action_history ADD COLUMN preview_blob BLOB;
        ALTER TABLE action_history ADD COLUMN preview_mime TEXT;
        """,
}


@dataclass(frozen=True)
class PreviewRecord:
    cache_key: str
    source_path: str
    image_blob: bytes
    original_width: int
    original_height: int
    analysis_width: int
    analysis_height: int
    source_dtype: str
    preview_source: str
    color_space: str
    data_range: tuple[float, float] | None
    created_at: float
    accessed_at: float


@dataclass(frozen=True)
class SessionRecord:
    session_id: str
    source_path: str | None
    session_data_json: str
    document_json: str | None
    ai_evaluations_json: str | None
    created_at: float
    updated_at: float
    history_cursor: int = -1
    calibrated_preview_blob: bytes | None = None
    calibrated_preview_mime: str | None = None


@dataclass(frozen=True)
class AnalysisCacheRecord:
    cache_key: str
    source_path: str
    input_report_json: str
    zones_json: str
    static_charts_json: str
    created_at: float


@dataclass(frozen=True)
class FileInventoryRecord:
    source_path: str
    file_size: int
    mtime_ns: int
    content_hash: str
    indexed_at: float


@dataclass(frozen=True)
class ActionHistoryRecord:
    id: int
    session_id: str
    description: str
    action_type: str
    params_json: str | None
    created_at: float
    sequence_no: int = 0
    before_state_json: str | None = None
    after_state_json: str | None = None
    preview_blob: bytes | None = None
    preview_mime: str | None = None


@dataclass
class FileSyncReport:
    added: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    modified: list[str] = field(default_factory=list)
    unchanged: int = 0

    @property
    def total_changes(self) -> int:
        return len(self.added) + len(self.removed) + len(self.modified)


class WorkspaceDB:
    """Thread-safe SQLite workspace database."""

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        self._conn: sqlite3.Connection | None = None
        self._init_db()

    def _init_db(self) -> None:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            str(self._db_path),
            check_same_thread=False,
            isolation_level=None,
        )
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA)
        self._run_migrations()
        self._set_metadata("db_version", str(DB_VERSION))

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            assert self._conn is not None
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def _set_metadata(self, key: str, value: str) -> None:
        with self._transaction() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
                (key, value),
            )

    def _run_migrations(self) -> None:
        existing = self._get_metadata("db_version")
        current = int(existing) if existing else 1
        for version in range(current + 1, DB_VERSION + 1):
            if version in _MIGRATIONS:
                assert self._conn is not None
                self._conn.executescript(_MIGRATIONS[version])

    def _get_metadata(self, key: str) -> str | None:
        with self._lock:
            assert self._conn is not None
            row = self._conn.execute(
                "SELECT value FROM metadata WHERE key = ?", (key,)
            ).fetchone()
        return row[0] if row else None

    # -- Previews ---------------------------------------------------------------

    def save_preview(self, record: PreviewRecord) -> None:
        data_range_json = (
            json.dumps(list(record.data_range)) if record.data_range is not None else None
        )
        with self._transaction() as conn:
            conn.execute(
                """\
                INSERT OR REPLACE INTO previews
                    (cache_key, source_path, image_blob,
                     original_width, original_height,
                     analysis_width, analysis_height,
                     source_dtype, preview_source, color_space,
                     data_range_json, created_at, accessed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.cache_key,
                    record.source_path,
                    record.image_blob,
                    record.original_width,
                    record.original_height,
                    record.analysis_width,
                    record.analysis_height,
                    record.source_dtype,
                    record.preview_source,
                    record.color_space,
                    data_range_json,
                    record.created_at,
                    record.accessed_at,
                ),
            )

    def load_preview(self, cache_key: str) -> PreviewRecord | None:
        with self._lock:
            assert self._conn is not None
            row = self._conn.execute(
                "SELECT * FROM previews WHERE cache_key = ?", (cache_key,)
            ).fetchone()
        if row is None:
            return None
        self._touch_preview_access(cache_key)
        return self._row_to_preview(row)

    def _touch_preview_access(self, cache_key: str) -> None:
        with self._lock:
            assert self._conn is not None
            self._conn.execute(
                "UPDATE previews SET accessed_at = ? WHERE cache_key = ?",
                (time.time(), cache_key),
            )

    def delete_preview(self, cache_key: str) -> bool:
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM previews WHERE cache_key = ?", (cache_key,)
            )
        return cursor.rowcount > 0

    def list_previews(self, source_path: str | None = None) -> list[PreviewRecord]:
        with self._lock:
            assert self._conn is not None
            if source_path:
                rows = self._conn.execute(
                    "SELECT * FROM previews WHERE source_path = ? ORDER BY accessed_at DESC",
                    (source_path,),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM previews ORDER BY accessed_at DESC"
                ).fetchall()
        return [self._row_to_preview(r) for r in rows]

    def cleanup_previews(self, max_age_seconds: float) -> int:
        cutoff = time.time() - max_age_seconds
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM previews WHERE accessed_at < ?", (cutoff,)
            )
        return cursor.rowcount

    def clear_previews(self) -> int:
        with self._transaction() as conn:
            cursor = conn.execute("DELETE FROM previews")
        return cursor.rowcount

    def preview_count(self) -> int:
        with self._lock:
            assert self._conn is not None
            row = self._conn.execute("SELECT COUNT(*) FROM previews").fetchone()
        return row[0]

    def preview_total_size(self) -> int:
        with self._lock:
            assert self._conn is not None
            row = self._conn.execute(
                "SELECT COALESCE(SUM(LENGTH(image_blob)), 0) FROM previews"
            ).fetchone()
        return row[0]

    @staticmethod
    def _row_to_preview(row: tuple) -> PreviewRecord:
        data_range = json.loads(row[10]) if row[10] else None
        return PreviewRecord(
            cache_key=row[0],
            source_path=row[1],
            image_blob=row[2],
            original_width=row[3],
            original_height=row[4],
            analysis_width=row[5],
            analysis_height=row[6],
            source_dtype=row[7],
            preview_source=row[8],
            color_space=row[9],
            data_range=tuple(data_range) if data_range else None,
            created_at=row[11],
            accessed_at=row[12],
        )

    # -- Sessions ---------------------------------------------------------------

    def save_session(self, record: SessionRecord) -> None:
        with self._transaction() as conn:
            existing = conn.execute(
                "SELECT created_at FROM sessions WHERE session_id = ?",
                (record.session_id,),
            ).fetchone()
            created_at = existing[0] if existing else record.created_at
            conn.execute(
                """\
                INSERT OR REPLACE INTO sessions
                    (session_id, source_path, session_data_json,
                     document_json, ai_evaluations_json,
                     created_at, updated_at, history_cursor,
                     calibrated_preview_blob, calibrated_preview_mime)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.session_id,
                    record.source_path,
                    record.session_data_json,
                    record.document_json,
                    record.ai_evaluations_json,
                    created_at,
                    record.updated_at,
                    record.history_cursor,
                    record.calibrated_preview_blob,
                    record.calibrated_preview_mime,
                ),
            )

    def load_session(self, session_id: str) -> SessionRecord | None:
        with self._lock:
            assert self._conn is not None
            row = self._conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
        if row is None:
            return None
        return self._row_to_session(row)

    def delete_session(self, session_id: str) -> bool:
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM sessions WHERE session_id = ?", (session_id,)
            )
        return cursor.rowcount > 0

    def list_sessions(self, source_path: str | None = None) -> list[SessionRecord]:
        with self._lock:
            assert self._conn is not None
            if source_path:
                rows = self._conn.execute(
                    "SELECT * FROM sessions WHERE source_path = ? ORDER BY updated_at DESC",
                    (source_path,),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM sessions ORDER BY updated_at DESC"
                ).fetchall()
        return [self._row_to_session(r) for r in rows]

    def cleanup_sessions(self, max_age_seconds: float) -> int:
        cutoff = time.time() - max_age_seconds
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM sessions WHERE updated_at < ?", (cutoff,)
            )
        return cursor.rowcount

    def clear_sessions(self) -> int:
        with self._transaction() as conn:
            cursor = conn.execute("DELETE FROM sessions")
        return cursor.rowcount

    def session_count(self) -> int:
        with self._lock:
            assert self._conn is not None
            row = self._conn.execute("SELECT COUNT(*) FROM sessions").fetchone()
        return row[0]

    @staticmethod
    def _row_to_session(row: tuple) -> SessionRecord:
        return SessionRecord(
            session_id=row[0],
            source_path=row[1],
            session_data_json=row[2],
            document_json=row[3],
            ai_evaluations_json=row[4],
            created_at=row[5],
            updated_at=row[6],
            history_cursor=row[7] if len(row) > 7 else -1,
            calibrated_preview_blob=row[8] if len(row) > 8 else None,
            calibrated_preview_mime=row[9] if len(row) > 9 else None,
        )

    # -- Analysis cache ---------------------------------------------------------

    def save_analysis(self, record: AnalysisCacheRecord) -> None:
        with self._transaction() as conn:
            conn.execute(
                """\
                INSERT OR REPLACE INTO analysis_cache
                    (cache_key, source_path, input_report_json,
                     zones_json, static_charts_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    record.cache_key,
                    record.source_path,
                    record.input_report_json,
                    record.zones_json,
                    record.static_charts_json,
                    record.created_at,
                ),
            )

    def load_analysis(self, cache_key: str) -> AnalysisCacheRecord | None:
        with self._lock:
            assert self._conn is not None
            row = self._conn.execute(
                "SELECT * FROM analysis_cache WHERE cache_key = ?", (cache_key,)
            ).fetchone()
        if row is None:
            return None
        return self._row_to_analysis(row)

    def delete_analysis(self, cache_key: str) -> bool:
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM analysis_cache WHERE cache_key = ?", (cache_key,)
            )
        return cursor.rowcount > 0

    def cleanup_analysis(self, max_age_seconds: float) -> int:
        cutoff = time.time() - max_age_seconds
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM analysis_cache WHERE created_at < ?", (cutoff,)
            )
        return cursor.rowcount

    def clear_analysis(self) -> int:
        with self._transaction() as conn:
            cursor = conn.execute("DELETE FROM analysis_cache")
        return cursor.rowcount

    def analysis_count(self) -> int:
        with self._lock:
            assert self._conn is not None
            row = self._conn.execute("SELECT COUNT(*) FROM analysis_cache").fetchone()
        return row[0]

    @staticmethod
    def _row_to_analysis(row: tuple) -> AnalysisCacheRecord:
        return AnalysisCacheRecord(
            cache_key=row[0],
            source_path=row[1],
            input_report_json=row[2],
            zones_json=row[3],
            static_charts_json=row[4],
            created_at=row[5],
        )

    # -- File inventory ---------------------------------------------------------

    def save_file_inventory(self, record: FileInventoryRecord) -> None:
        with self._transaction() as conn:
            conn.execute(
                """\
                INSERT OR REPLACE INTO file_inventory
                    (source_path, file_size, mtime_ns, content_hash, indexed_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    record.source_path,
                    record.file_size,
                    record.mtime_ns,
                    record.content_hash,
                    record.indexed_at,
                ),
            )

    def load_file_inventory(self) -> dict[str, FileInventoryRecord]:
        with self._lock:
            assert self._conn is not None
            rows = self._conn.execute(
                "SELECT * FROM file_inventory"
            ).fetchall()
        return {
            row[0]: FileInventoryRecord(
                source_path=row[0],
                file_size=row[1],
                mtime_ns=row[2],
                content_hash=row[3],
                indexed_at=row[4],
            )
            for row in rows
        }

    def delete_file_inventory(self, source_path: str) -> bool:
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM file_inventory WHERE source_path = ?", (source_path,)
            )
        return cursor.rowcount > 0

    def clear_file_inventory(self) -> int:
        with self._transaction() as conn:
            cursor = conn.execute("DELETE FROM file_inventory")
        return cursor.rowcount

    def invalidate_source(self, source_path: str) -> dict[str, int]:
        """Remove all cache entries (previews, sessions, analysis) for a source file."""
        with self._transaction() as conn:
            session_ids = [
                row[0]
                for row in conn.execute(
                    "SELECT session_id FROM sessions WHERE source_path = ?", (source_path,)
                ).fetchall()
            ]
            history_count = 0
            for session_id in session_ids:
                history_count += conn.execute(
                    "DELETE FROM action_history WHERE session_id = ?", (session_id,)
                ).rowcount
            preview_cursor = conn.execute(
                "DELETE FROM previews WHERE source_path = ?", (source_path,)
            )
            session_cursor = conn.execute(
                "DELETE FROM sessions WHERE source_path = ?", (source_path,)
            )
            analysis_cursor = conn.execute(
                "DELETE FROM analysis_cache WHERE source_path = ?", (source_path,)
            )
            inv_cursor = conn.execute(
                "DELETE FROM file_inventory WHERE source_path = ?", (source_path,)
            )
        return {
            "previews": preview_cursor.rowcount,
            "sessions": session_cursor.rowcount,
            "history": history_count,
            "analysis": analysis_cursor.rowcount,
            "inventory": inv_cursor.rowcount,
        }

    def sync_directory(
        self,
        directory: Path,
        extensions: set[str] | None = None,
    ) -> FileSyncReport:
        """Scan directory and invalidate cache for removed/modified files.

        Uses file size + mtime for fast change detection, then partial hash
        (first 64KB) for confirmation.

        Args:
            directory: Directory to scan for image files.
            extensions: Set of file extensions to include (e.g., {'.tif', '.tiff', '.jpg'}).
                       If None, uses common image extensions.

        Returns:
            FileSyncReport with added, removed, modified, unchanged counts.
        """
        if extensions is None:
            extensions = {
                ".jpg", ".jpeg", ".png", ".tif", ".tiff",
                ".dng", ".cr2", ".nef", ".arw", ".raf",
            }

        report = FileSyncReport()
        existing_inventory = self.load_file_inventory()
        current_files: dict[str, tuple[int, int]] = {}

        if directory.is_dir():
            for path in directory.rglob("*"):
                if path.is_file() and path.suffix.lower() in extensions:
                    stat = path.stat()
                    current_files[str(path)] = (stat.st_size, stat.st_mtime_ns)

        db_paths = set(existing_inventory.keys())
        current_paths = set(current_files.keys())

        removed_paths = db_paths - current_paths
        added_paths = current_paths - db_paths
        common_paths = db_paths & current_paths

        for path_str in removed_paths:
            self.invalidate_source(path_str)
            report.removed.append(path_str)

        for path_str in added_paths:
            file_size, mtime_ns = current_files[path_str]
            content_hash = self._compute_partial_hash(Path(path_str))
            self.save_file_inventory(
                FileInventoryRecord(
                    source_path=path_str,
                    file_size=file_size,
                    mtime_ns=mtime_ns,
                    content_hash=content_hash,
                    indexed_at=time.time(),
                )
            )
            report.added.append(path_str)

        for path_str in common_paths:
            file_size, mtime_ns = current_files[path_str]
            inv = existing_inventory[path_str]

            if inv.file_size != file_size or inv.mtime_ns != mtime_ns:
                content_hash = self._compute_partial_hash(Path(path_str))
                if inv.content_hash != content_hash:
                    self.invalidate_source(path_str)
                    self.save_file_inventory(
                        FileInventoryRecord(
                            source_path=path_str,
                            file_size=file_size,
                            mtime_ns=mtime_ns,
                            content_hash=content_hash,
                            indexed_at=time.time(),
                        )
                    )
                    report.modified.append(path_str)
                else:
                    self.save_file_inventory(
                        FileInventoryRecord(
                            source_path=path_str,
                            file_size=file_size,
                            mtime_ns=mtime_ns,
                            content_hash=inv.content_hash,
                            indexed_at=time.time(),
                        )
                    )
                    report.unchanged += 1
            else:
                report.unchanged += 1

        return report

    @staticmethod
    def _compute_partial_hash(path: Path, chunk_size: int = 65536) -> str:
        """Compute SHA256 hash of first 64KB of file for fast change detection."""
        hasher = hashlib.sha256()
        try:
            with path.open("rb") as f:
                data = f.read(chunk_size)
                hasher.update(data)
            return hasher.hexdigest()
        except OSError:
            return ""

    # -- Aggregate stats --------------------------------------------------------

    def inventory_count(self) -> int:
        with self._lock:
            assert self._conn is not None
            row = self._conn.execute("SELECT COUNT(*) FROM file_inventory").fetchone()
        return row[0]

    def stats(self) -> dict[str, Any]:
        return {
            "db_path": str(self._db_path),
            "db_version": self._get_metadata("db_version"),
            "preview_count": self.preview_count(),
            "preview_total_bytes": self.preview_total_size(),
            "session_count": self.session_count(),
            "analysis_count": self.analysis_count(),
            "inventory_count": self.inventory_count(),
        }

    def clear_all(self) -> dict[str, int]:
        return {
            "previews": self.clear_previews(),
            "sessions": self.clear_sessions(),
            "analysis": self.clear_analysis(),
            "inventory": self.clear_file_inventory(),
            "history": self.clear_action_history(),
        }

    def save_action(self, session_id: str, description: str, action_type: str = "calibration", params: dict | None = None) -> int:
        with self._transaction() as conn:
            cur = conn.execute(
                "INSERT INTO action_history (session_id, description, action_type, params_json, created_at) VALUES (?, ?, ?, ?, ?)",
                (session_id, description, action_type, json.dumps(params) if params else None, time.time()),
            )
            return cur.lastrowid or 0

    def commit_action(
        self,
        *,
        session_id: str,
        source_path: str,
        description: str,
        action_type: str,
        before_state: dict[str, Any],
        after_state: dict[str, Any],
        document: dict[str, Any] | None = None,
        preview_blob: bytes | None = None,
        preview_mime: str | None = None,
        max_actions: int = 50,
    ) -> tuple[int, int]:
        """Append one committed edit and atomically update the restored state."""
        now = time.time()
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT history_cursor, created_at FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            cursor = int(row[0]) if row else -1
            created_at = float(row[1]) if row else now
            conn.execute(
                "DELETE FROM action_history WHERE session_id = ? AND sequence_no > ?",
                (session_id, cursor),
            )
            next_sequence = cursor + 1
            conn.execute(
                """INSERT INTO action_history
                   (session_id, description, action_type, params_json, sequence_no,
                    before_state_json, after_state_json, preview_blob, preview_mime, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_id,
                    description,
                    action_type,
                    json.dumps(after_state, ensure_ascii=False),
                    next_sequence,
                    json.dumps(before_state, ensure_ascii=False),
                    json.dumps(after_state, ensure_ascii=False),
                    preview_blob,
                    preview_mime,
                    now,
                ),
            )
            conn.execute(
                """INSERT OR REPLACE INTO sessions
                   (session_id, source_path, session_data_json, document_json,
                    ai_evaluations_json, created_at, updated_at, history_cursor,
                    calibrated_preview_blob, calibrated_preview_mime)
                   VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)""",
                (
                    session_id,
                    source_path,
                    json.dumps(after_state, ensure_ascii=False),
                    json.dumps(document, ensure_ascii=False) if document is not None else None,
                    created_at,
                    now,
                    next_sequence,
                    preview_blob,
                    preview_mime,
                ),
            )
            rows = conn.execute(
                "SELECT sequence_no FROM action_history WHERE session_id = ? ORDER BY sequence_no DESC",
                (session_id,),
            ).fetchall()
            if len(rows) > max_actions:
                cutoff = int(rows[max_actions - 1][0])
                conn.execute(
                    "DELETE FROM action_history WHERE session_id = ? AND sequence_no < ?",
                    (session_id, cutoff),
                )
        return next_sequence, next_sequence

    def move_history_cursor(self, session_id: str, direction: int) -> tuple[int, dict[str, Any], bytes | None, str | None] | None:
        with self._transaction() as conn:
            session = conn.execute(
                "SELECT history_cursor, session_data_json FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if session is None:
                return None
            cursor = int(session[0])
            target = cursor + direction
            row = conn.execute(
                """SELECT before_state_json, after_state_json, preview_blob, preview_mime FROM action_history
                   WHERE session_id = ? AND sequence_no = ?""",
                (session_id, cursor if direction < 0 else target),
            ).fetchone()
            if row is None:
                return None
            state_json = row[0] if direction < 0 else row[1]
            if not state_json:
                return None
            preview_row = conn.execute(
                "SELECT preview_blob, preview_mime FROM action_history WHERE session_id = ? AND sequence_no = ?",
                (session_id, target),
            ).fetchone()
            conn.execute(
                """UPDATE sessions
                   SET history_cursor = ?, session_data_json = ?, updated_at = ?,
                       calibrated_preview_blob = ?, calibrated_preview_mime = ?
                   WHERE session_id = ?""",
                (
                    target,
                    state_json,
                    time.time(),
                    preview_row[0] if preview_row else None,
                    preview_row[1] if preview_row else None,
                    session_id,
                ),
            )
        return (
            target,
            json.loads(state_json),
            preview_row[0] if preview_row else None,
            preview_row[1] if preview_row else None,
        )

    def load_actions(self, session_id: str, limit: int = 50) -> list[ActionHistoryRecord]:
        with self._lock:
            assert self._conn is not None
            rows = self._conn.execute(
                """SELECT id, session_id, description, action_type, params_json, created_at,
                          sequence_no, before_state_json, after_state_json, preview_blob, preview_mime
                   FROM action_history WHERE session_id = ? ORDER BY sequence_no ASC LIMIT ?""",
                (session_id, limit),
            ).fetchall()
        return [
            ActionHistoryRecord(
                id=r[0], session_id=r[1], description=r[2], action_type=r[3],
                params_json=r[4], created_at=r[5], sequence_no=r[6],
                before_state_json=r[7], after_state_json=r[8],
                preview_blob=r[9], preview_mime=r[10],
            )
            for r in rows
        ]

    def clear_action_history(self, session_id: str | None = None) -> int:
        with self._transaction() as conn:
            if session_id:
                cur = conn.execute("DELETE FROM action_history WHERE session_id = ?", (session_id,))
            else:
                cur = conn.execute("DELETE FROM action_history")
            return cur.rowcount

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None


_DB_INSTANCES: dict[str, WorkspaceDB] = {}
_DB_LOCK = threading.Lock()


def get_workspace_db(root: Path | None = None) -> WorkspaceDB:
    """Return a WorkspaceDB keyed by normalized workspace root."""
    with _DB_LOCK:
        if root is None:
            root = Path(__file__).resolve().parents[3]
        resolved = root.expanduser().resolve()
        db_path = resolved / (".cache/workspace.db" if resolved == Path(__file__).resolve().parents[3] else "photo-calibrator.db")
        key = str(db_path)
        if key not in _DB_INSTANCES:
            _DB_INSTANCES[key] = WorkspaceDB(db_path)
        return _DB_INSTANCES[key]


def reset_workspace_db() -> None:
    """Close and discard all cached database instances (for testing)."""
    with _DB_LOCK:
        for instance in _DB_INSTANCES.values():
            instance.close()
        _DB_INSTANCES.clear()
