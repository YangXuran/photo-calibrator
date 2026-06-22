"""Tests for workspace_db — single-file SQLite workspace database."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from photo_calibrator.backend.workspace_db import (
    AnalysisCacheRecord,
    FileInventoryRecord,
    FileSyncReport,
    PreviewRecord,
    SessionRecord,
    WorkspaceDB,
    get_workspace_db,
    reset_workspace_db,
)


@pytest.fixture()
def db(tmp_path: Path) -> WorkspaceDB:
    db_path = tmp_path / ".cache" / "workspace.db"
    return WorkspaceDB(db_path)


def _make_preview(
    cache_key: str = "abc123",
    source_path: str = "/photos/test.tif",
    image_blob: bytes = b"\xff\xd8\xff\xe0fake-jpeg",
    **overrides: object,
) -> PreviewRecord:
    defaults = dict(
        cache_key=cache_key,
        source_path=source_path,
        image_blob=image_blob,
        original_width=4000,
        original_height=3000,
        analysis_width=1600,
        analysis_height=1200,
        source_dtype="uint16",
        preview_source="opencv-decode",
        color_space="sRGB",
        data_range=(0.0, 1.0),
        created_at=time.time(),
        accessed_at=time.time(),
    )
    defaults.update(overrides)
    return PreviewRecord(**defaults)


def _make_session(
    session_id: str = "sess-001",
    source_path: str | None = "/photos/test.tif",
    **overrides: object,
) -> SessionRecord:
    now = time.time()
    defaults = dict(
        session_id=session_id,
        source_path=source_path,
        session_data_json=json.dumps({"mode": "global", "a_shift": -2.5, "b_shift": 1.3}),
        document_json=json.dumps({"operations": [{"name": "lab_shift", "params": {"a": -2.5}}]}),
        ai_evaluations_json=json.dumps({"score": 0.85, "issues": []}),
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return SessionRecord(**defaults)


def _make_analysis(
    cache_key: str = "ana-001",
    source_path: str = "/photos/test.tif",
    **overrides: object,
) -> AnalysisCacheRecord:
    defaults = dict(
        cache_key=cache_key,
        source_path=source_path,
        input_report_json=json.dumps({"mean_a": 128.5, "mean_b": 130.2}),
        zones_json=json.dumps({"shadow": 0.1, "midtone": 0.7, "highlight": 0.2}),
        static_charts_json=json.dumps({"histogram": [1, 2, 3]}),
        created_at=time.time(),
    )
    defaults.update(overrides)
    return AnalysisCacheRecord(**defaults)


class TestPreviewCRUD:
    def test_save_and_load(self, db: WorkspaceDB) -> None:
        rec = _make_preview()
        db.save_preview(rec)
        loaded = db.load_preview("abc123")
        assert loaded is not None
        assert loaded.cache_key == "abc123"
        assert loaded.source_path == "/photos/test.tif"
        assert loaded.image_blob == b"\xff\xd8\xff\xe0fake-jpeg"
        assert loaded.original_width == 4000
        assert loaded.color_space == "sRGB"
        assert loaded.data_range == (0.0, 1.0)

    def test_load_missing_returns_none(self, db: WorkspaceDB) -> None:
        assert db.load_preview("nonexistent") is None

    def test_save_overwrites(self, db: WorkspaceDB) -> None:
        db.save_preview(_make_preview(image_blob=b"old"))
        db.save_preview(_make_preview(image_blob=b"new"))
        loaded = db.load_preview("abc123")
        assert loaded is not None
        assert loaded.image_blob == b"new"
        assert db.preview_count() == 1

    def test_delete(self, db: WorkspaceDB) -> None:
        db.save_preview(_make_preview())
        assert db.delete_preview("abc123") is True
        assert db.load_preview("abc123") is None
        assert db.delete_preview("abc123") is False

    def test_list_all(self, db: WorkspaceDB) -> None:
        db.save_preview(_make_preview("k1", "/a.tif"))
        db.save_preview(_make_preview("k2", "/b.tif"))
        db.save_preview(_make_preview("k3", "/a.tif"))
        all_previews = db.list_previews()
        assert len(all_previews) == 3

    def test_list_by_source(self, db: WorkspaceDB) -> None:
        db.save_preview(_make_preview("k1", "/a.tif"))
        db.save_preview(_make_preview("k2", "/b.tif"))
        db.save_preview(_make_preview("k3", "/a.tif"))
        a_previews = db.list_previews(source_path="/a.tif")
        assert len(a_previews) == 2
        assert all(p.source_path == "/a.tif" for p in a_previews)

    def test_cleanup_by_age(self, db: WorkspaceDB) -> None:
        old_time = time.time() - 7200
        db.save_preview(_make_preview("old", accessed_at=old_time))
        db.save_preview(_make_preview("new"))
        deleted = db.cleanup_previews(max_age_seconds=3600)
        assert deleted == 1
        assert db.load_preview("old") is None
        assert db.load_preview("new") is not None

    def test_clear_previews(self, db: WorkspaceDB) -> None:
        db.save_preview(_make_preview("k1"))
        db.save_preview(_make_preview("k2"))
        assert db.clear_previews() == 2
        assert db.preview_count() == 0

    def test_preview_total_size(self, db: WorkspaceDB) -> None:
        db.save_preview(_make_preview("k1", image_blob=b"12345"))
        db.save_preview(_make_preview("k2", image_blob=b"67890abcde"))
        assert db.preview_total_size() == 15

    def test_data_range_none(self, db: WorkspaceDB) -> None:
        rec = _make_preview(data_range=None)
        db.save_preview(rec)
        loaded = db.load_preview("abc123")
        assert loaded is not None
        assert loaded.data_range is None


class TestSessionCRUD:
    def test_save_and_load(self, db: WorkspaceDB) -> None:
        rec = _make_session()
        db.save_session(rec)
        loaded = db.load_session("sess-001")
        assert loaded is not None
        assert loaded.session_id == "sess-001"
        assert loaded.source_path == "/photos/test.tif"
        data = json.loads(loaded.session_data_json)
        assert data["mode"] == "global"
        assert data["a_shift"] == -2.5

    def test_load_missing_returns_none(self, db: WorkspaceDB) -> None:
        assert db.load_session("nonexistent") is None

    def test_save_preserves_created_at(self, db: WorkspaceDB) -> None:
        t1 = time.time() - 100
        db.save_session(_make_session(created_at=t1, updated_at=t1))
        t2 = time.time()
        db.save_session(_make_session(created_at=t2, updated_at=t2))
        loaded = db.load_session("sess-001")
        assert loaded is not None
        assert abs(loaded.created_at - t1) < 1.0

    def test_delete(self, db: WorkspaceDB) -> None:
        db.save_session(_make_session())
        assert db.delete_session("sess-001") is True
        assert db.load_session("sess-001") is None
        assert db.delete_session("sess-001") is False

    def test_list_all(self, db: WorkspaceDB) -> None:
        db.save_session(_make_session("s1"))
        db.save_session(_make_session("s2"))
        db.save_session(_make_session("s3"))
        assert len(db.list_sessions()) == 3

    def test_list_by_source(self, db: WorkspaceDB) -> None:
        db.save_session(_make_session("s1", "/a.tif"))
        db.save_session(_make_session("s2", "/b.tif"))
        db.save_session(_make_session("s3", "/a.tif"))
        a_sessions = db.list_sessions(source_path="/a.tif")
        assert len(a_sessions) == 2

    def test_cleanup_by_age(self, db: WorkspaceDB) -> None:
        old_time = time.time() - 7200
        db.save_session(_make_session("old", created_at=old_time, updated_at=old_time))
        db.save_session(_make_session("new"))
        deleted = db.cleanup_sessions(max_age_seconds=3600)
        assert deleted == 1
        assert db.load_session("old") is None
        assert db.load_session("new") is not None

    def test_clear_sessions(self, db: WorkspaceDB) -> None:
        db.save_session(_make_session("s1"))
        db.save_session(_make_session("s2"))
        assert db.clear_sessions() == 2
        assert db.session_count() == 0

    def test_document_and_ai_fields(self, db: WorkspaceDB) -> None:
        db.save_session(_make_session())
        loaded = db.load_session("sess-001")
        assert loaded is not None
        doc = json.loads(loaded.document_json)
        assert doc["operations"][0]["name"] == "lab_shift"
        ai = json.loads(loaded.ai_evaluations_json)
        assert ai["score"] == 0.85


class TestAnalysisCacheCRUD:
    def test_save_and_load(self, db: WorkspaceDB) -> None:
        rec = _make_analysis()
        db.save_analysis(rec)
        loaded = db.load_analysis("ana-001")
        assert loaded is not None
        assert loaded.cache_key == "ana-001"
        report = json.loads(loaded.input_report_json)
        assert report["mean_a"] == 128.5

    def test_load_missing_returns_none(self, db: WorkspaceDB) -> None:
        assert db.load_analysis("nonexistent") is None

    def test_delete(self, db: WorkspaceDB) -> None:
        db.save_analysis(_make_analysis())
        assert db.delete_analysis("ana-001") is True
        assert db.load_analysis("ana-001") is None

    def test_cleanup_by_age(self, db: WorkspaceDB) -> None:
        old_time = time.time() - 7200
        db.save_analysis(_make_analysis("old", created_at=old_time))
        db.save_analysis(_make_analysis("new"))
        deleted = db.cleanup_analysis(max_age_seconds=3600)
        assert deleted == 1
        assert db.load_analysis("old") is None
        assert db.load_analysis("new") is not None

    def test_clear_analysis(self, db: WorkspaceDB) -> None:
        db.save_analysis(_make_analysis("a1"))
        db.save_analysis(_make_analysis("a2"))
        assert db.clear_analysis() == 2
        assert db.analysis_count() == 0


class TestAggregateOps:
    def test_stats(self, db: WorkspaceDB) -> None:
        db.save_preview(_make_preview("p1", image_blob=b"hello"))
        db.save_session(_make_session("s1"))
        db.save_analysis(_make_analysis("a1"))
        stats = db.stats()
        assert stats["preview_count"] == 1
        assert stats["preview_total_bytes"] == 5
        assert stats["session_count"] == 1
        assert stats["analysis_count"] == 1
        assert stats["db_version"] == "4"


class TestPersistentActionHistory:
    def test_commit_undo_redo_and_truncate_branch(self, db: WorkspaceDB) -> None:
        source = "/photos/test.tif"
        first = {"mode": "global", "strength": 0.8}
        second = {"mode": "global", "strength": 0.6}
        third = {"mode": "skin-priority", "strength": 0.6}
        db.commit_action(
            session_id="persistent-1", source_path=source, description="strength",
            action_type="strength", before_state=first, after_state=second,
            preview_blob=b"preview-1", preview_mime="image/jpeg",
        )
        db.commit_action(
            session_id="persistent-1", source_path=source, description="mode",
            action_type="mode", before_state=second, after_state=third,
            preview_blob=b"preview-2", preview_mime="image/jpeg",
        )

        cursor, state, blob, _mime = db.move_history_cursor("persistent-1", -1) or (-9, {}, None, None)
        assert cursor == 0
        assert state == second
        assert blob == b"preview-1"
        assert db.load_session("persistent-1").calibrated_preview_blob == b"preview-1"

        replacement = {"mode": "film", "strength": 0.6}
        db.commit_action(
            session_id="persistent-1", source_path=source, description="branch",
            action_type="mode", before_state=second, after_state=replacement,
        )
        actions = db.load_actions("persistent-1")
        assert [json.loads(item.after_state_json or "{}") for item in actions] == [second, replacement]
        assert db.move_history_cursor("persistent-1", 1) is None

    def test_action_limit_keeps_latest_fifty(self, db: WorkspaceDB) -> None:
        for index in range(55):
            db.commit_action(
                session_id="persistent-limit", source_path="/photos/test.tif",
                description=str(index), action_type="strength",
                before_state={"value": index}, after_state={"value": index + 1},
            )
        actions = db.load_actions("persistent-limit", limit=100)
        assert len(actions) == 50
        assert actions[0].sequence_no == 5

    def test_registry_isolated_by_workspace_root(self, tmp_path: Path) -> None:
        reset_workspace_db()
        try:
            first_root = tmp_path / "first"
            second_root = tmp_path / "second"
            first_root.mkdir()
            second_root.mkdir()
            first = get_workspace_db(first_root)
            second = get_workspace_db(second_root)
            assert first is not second
            assert Path(first.stats()["db_path"]) == first_root / "photo-calibrator.db"
            assert Path(second.stats()["db_path"]) == second_root / "photo-calibrator.db"
        finally:
            reset_workspace_db()

    def test_clear_all(self, db: WorkspaceDB) -> None:
        db.save_preview(_make_preview("p1"))
        db.save_session(_make_session("s1"))
        db.save_analysis(_make_analysis("a1"))
        result = db.clear_all()
        assert result["previews"] == 1
        assert result["sessions"] == 1
        assert result["analysis"] == 1
        assert db.preview_count() == 0
        assert db.session_count() == 0
        assert db.analysis_count() == 0


class TestSingleton:
    def test_get_workspace_db_returns_same_instance(self, tmp_path: Path) -> None:
        reset_workspace_db()
        try:
            db1 = get_workspace_db(tmp_path)
            db2 = get_workspace_db(tmp_path)
            assert db1 is db2
        finally:
            reset_workspace_db()

    def test_reset_closes_and_discards(self, tmp_path: Path) -> None:
        reset_workspace_db()
        db1 = get_workspace_db(tmp_path)
        reset_workspace_db()
        db2 = get_workspace_db(tmp_path)
        assert db1 is not db2


class TestFileInventory:
    def test_save_and_load_inventory(self, db: WorkspaceDB) -> None:
        rec = FileInventoryRecord(
            source_path="/photos/test.tif",
            file_size=1234567,
            mtime_ns=1234567890000000000,
            content_hash="abc123def456",
            indexed_at=time.time(),
        )
        db.save_file_inventory(rec)
        inventory = db.load_file_inventory()
        assert "/photos/test.tif" in inventory
        loaded = inventory["/photos/test.tif"]
        assert loaded.file_size == 1234567
        assert loaded.content_hash == "abc123def456"

    def test_delete_inventory(self, db: WorkspaceDB) -> None:
        rec = FileInventoryRecord(
            source_path="/photos/test.tif",
            file_size=1234567,
            mtime_ns=1234567890000000000,
            content_hash="abc123def456",
            indexed_at=time.time(),
        )
        db.save_file_inventory(rec)
        assert db.delete_file_inventory("/photos/test.tif") is True
        assert db.load_file_inventory() == {}

    def test_clear_inventory(self, db: WorkspaceDB) -> None:
        for i in range(3):
            db.save_file_inventory(
                FileInventoryRecord(
                    source_path=f"/photos/test{i}.tif",
                    file_size=1000 * i,
                    mtime_ns=1234567890000000000 + i,
                    content_hash=f"hash{i}",
                    indexed_at=time.time(),
                )
            )
        assert db.clear_file_inventory() == 3
        assert db.inventory_count() == 0


class TestInvalidateSource:
    def test_invalidate_removes_all_cache(self, db: WorkspaceDB) -> None:
        source = "/photos/test.tif"
        db.save_preview(_make_preview("p1", source))
        db.save_session(_make_session("s1", source))
        db.save_analysis(_make_analysis("a1", source))
        db.save_file_inventory(
            FileInventoryRecord(
                source_path=source,
                file_size=1000,
                mtime_ns=1234567890000000000,
                content_hash="hash1",
                indexed_at=time.time(),
            )
        )

        result = db.invalidate_source(source)
        assert result["previews"] == 1
        assert result["sessions"] == 1
        assert result["analysis"] == 1
        assert result["inventory"] == 1
        assert db.preview_count() == 0
        assert db.session_count() == 0
        assert db.analysis_count() == 0
        assert db.inventory_count() == 0


class TestSyncDirectory:
    def test_sync_empty_directory(self, db: WorkspaceDB, tmp_path: Path) -> None:
        report = db.sync_directory(tmp_path)
        assert report.total_changes == 0
        assert report.unchanged == 0

    def test_sync_new_files(self, db: WorkspaceDB, tmp_path: Path) -> None:
        (tmp_path / "test1.tif").write_bytes(b"fake tiff data 1")
        (tmp_path / "test2.jpg").write_bytes(b"fake jpeg data 2")

        report = db.sync_directory(tmp_path)
        assert len(report.added) == 2
        assert report.unchanged == 0
        assert db.inventory_count() == 2

    def test_sync_removed_files(self, db: WorkspaceDB, tmp_path: Path) -> None:
        file1 = tmp_path / "test1.tif"
        file1.write_bytes(b"fake tiff data 1")
        db.sync_directory(tmp_path)

        file1.unlink()
        report = db.sync_directory(tmp_path)
        assert len(report.removed) == 1
        assert db.inventory_count() == 0

    def test_sync_modified_file(self, db: WorkspaceDB, tmp_path: Path) -> None:
        file1 = tmp_path / "test1.tif"
        file1.write_bytes(b"original content")
        db.sync_directory(tmp_path)

        time.sleep(0.01)
        file1.write_bytes(b"modified content with different size")
        report = db.sync_directory(tmp_path)
        assert len(report.modified) == 1
        assert report.unchanged == 0

    def test_sync_unchanged_files(self, db: WorkspaceDB, tmp_path: Path) -> None:
        file1 = tmp_path / "test1.tif"
        file1.write_bytes(b"stable content")
        db.sync_directory(tmp_path)

        report = db.sync_directory(tmp_path)
        assert report.total_changes == 0
        assert report.unchanged == 1

    def test_sync_invalidates_cache_for_modified(
        self, db: WorkspaceDB, tmp_path: Path
    ) -> None:
        file1 = tmp_path / "test1.tif"
        file1.write_bytes(b"original content")
        db.sync_directory(tmp_path)

        source = str(file1)
        db.save_preview(_make_preview("p1", source))
        db.save_session(_make_session("s1", source))

        time.sleep(0.01)
        file1.write_bytes(b"modified content with different size")
        report = db.sync_directory(tmp_path)
        assert len(report.modified) == 1
        assert db.preview_count() == 0
        assert db.session_count() == 0

    def test_sync_custom_extensions(self, db: WorkspaceDB, tmp_path: Path) -> None:
        (tmp_path / "test1.tif").write_bytes(b"tiff data")
        (tmp_path / "test2.jpg").write_bytes(b"jpeg data")
        (tmp_path / "test3.png").write_bytes(b"png data")

        report = db.sync_directory(tmp_path, extensions={".tif"})
        assert len(report.added) == 1
        assert db.inventory_count() == 1

    def test_sync_recursive(self, db: WorkspaceDB, tmp_path: Path) -> None:
        subdir = tmp_path / "subdir"
        subdir.mkdir()
        (tmp_path / "test1.tif").write_bytes(b"tiff data 1")
        (subdir / "test2.tif").write_bytes(b"tiff data 2")

        report = db.sync_directory(tmp_path)
        assert len(report.added) == 2
        assert db.inventory_count() == 2
