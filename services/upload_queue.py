from __future__ import annotations

import asyncio
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Category = Literal["video", "rgb", "thermal"]

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_ROOT = BASE_DIR / "public" / "uploads"
DIR_BY_CATEGORY: dict[Category, Path] = {
    "video": UPLOAD_ROOT / "videos",
    "rgb": UPLOAD_ROOT / "rgbimages",
    "thermal": UPLOAD_ROOT / "thermalimages",
}

_sio = None
_queue: asyncio.Queue[QueuedFile | None] | None = None
_worker_task: asyncio.Task | None = None
_jobs: dict[str, "UploadJob"] = {}


@dataclass
class UploadJob:
    job_id: str
    category: Category
    total: int
    completed: int = 0


@dataclass
class QueuedFile:
    job_id: str
    filename: str
    data: bytes


def set_sio(sio_instance) -> None:
    global _sio
    _sio = sio_instance


def ensure_upload_dirs() -> None:
    for path in DIR_BY_CATEGORY.values():
        path.mkdir(parents=True, exist_ok=True)


def _safe_filename(name: str) -> str:
    base = Path(name).name
    base = re.sub(r"[^\w.\-]", "_", base, flags=re.UNICODE)
    return (base or "file")[:200]


def allowed_extension(category: Category, filename: str) -> bool:
    lower = filename.lower()
    if category == "video":
        return lower.endswith(".mp4")
    if category == "thermal":
        return (
            lower.endswith(".png")
            or lower.endswith(".jpg")
            or lower.endswith(".jpeg")
            or lower.endswith(".mp4")
        )
    return lower.endswith(".png") or lower.endswith(".jpg") or lower.endswith(".jpeg")


async def start_batch(total: int, category: Category) -> str:
    job_id = str(uuid.uuid4())
    _jobs[job_id] = UploadJob(job_id=job_id, category=category, total=total)
    return job_id


def get_job(job_id: str) -> UploadJob | None:
    return _jobs.get(job_id)


async def enqueue_file(job_id: str, filename: str, data: bytes) -> None:
    job = _jobs.get(job_id)
    if not job:
        raise LookupError("job not found")
    if not allowed_extension(job.category, filename):
        raise ValueError("file type not allowed for this job category")
    q = _queue
    if q is None:
        raise RuntimeError("upload queue not started")
    await q.put(QueuedFile(job_id=job_id, filename=filename, data=data))


async def _worker_loop() -> None:
    global _queue
    assert _queue is not None
    while True:
        item = await _queue.get()
        try:
            job = _jobs.get(item.job_id)
            if not _sio or not job:
                continue
            dest_dir = DIR_BY_CATEGORY[job.category]
            dest_dir.mkdir(parents=True, exist_ok=True)
            unique = f"{uuid.uuid4().hex}_{_safe_filename(item.filename)}"
            out_path = dest_dir / unique
            out_path.write_bytes(item.data)
            job.completed += 1
            total = job.total
            percent = min(100, int(100 * job.completed / total)) if total else 100
            await _sio.emit(
                "upload_progress",
                {
                    "job_id": item.job_id,
                    "completed": job.completed,
                    "total": total,
                    "percent": percent,
                    "filename": item.filename,
                },
                room=item.job_id,
            )
            if job.completed >= job.total:
                await _sio.emit("upload_complete", {"job_id": item.job_id}, room=item.job_id)
                _jobs.pop(item.job_id, None)
        finally:
            _queue.task_done()


def start_worker() -> asyncio.Task:
    global _queue, _worker_task
    if _worker_task is not None and not _worker_task.done():
        return _worker_task
    _queue = asyncio.Queue()
    _worker_task = asyncio.create_task(_worker_loop(), name="upload-worker")
    return _worker_task


async def stop_worker() -> None:
    global _queue, _worker_task
    if _worker_task is not None:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
        _worker_task = None
    _queue = None
