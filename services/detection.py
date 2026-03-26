"""
Defect detection pipeline — YOLO 11 + SAHI (sliced-aided hyper-inference).

- Loads best.pt weights once (lazy singleton).
- Images: full-image + SAHI sliced inference → NMS merge.
- Videos: frame-sampled per-frame inference.
- Heavy lifting runs in a ThreadPoolExecutor so the async loop stays free.
- Progress is streamed via Socket.IO in real time.
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE_DIR / "tl_defect_cn1" / "weights" / "best.pt"
RESULTS_ROOT = BASE_DIR / "public" / "results"
THUMB_SIZE = 320
VIDEO_FRAME_STRIDE = 30

_model = None
_sio = None
_pool = ThreadPoolExecutor(max_workers=1)
_queue: asyncio.Queue | None = None
_worker: asyncio.Task | None = None
_jobs: dict[str, DetectionBatch] = {}


@dataclass
class DetectionBatch:
    job_id: str
    total: int = 0
    completed: int = 0
    confidence: float = 0.25
    slice_size: int = 640
    overlap: float = 0.2
    files: dict[str, DetectionFile] = field(default_factory=dict)


@dataclass
class DetectionFile:
    file_id: str
    job_id: str
    filename: str
    path: str
    file_type: str
    status: str = "queued"
    detections: list = field(default_factory=list)
    thumb_url: str = ""
    annotated_url: str = ""
    stats: dict = field(default_factory=dict)
    frames: list = field(default_factory=list)


@dataclass
class _QItem:
    file: DetectionFile
    batch: DetectionBatch


# ── Model ─────────────────────────────────────────────────────────────

def _load_model():
    global _model
    if _model is None:
        from ultralytics import YOLO
        _model = YOLO(str(MODEL_PATH))
    return _model


def set_sio(sio):
    global _sio
    _sio = sio


def ensure_dirs():
    RESULTS_ROOT.mkdir(parents=True, exist_ok=True)


# ── Batch / queue public API ─────────────────────────────────────────

def get_or_create_batch(job_id: str, **kw) -> DetectionBatch:
    if job_id not in _jobs:
        _jobs[job_id] = DetectionBatch(job_id=job_id, **kw)
    return _jobs[job_id]


def configure_batch(job_id: str, confidence: float, slice_size: int, overlap: float):
    b = get_or_create_batch(job_id)
    b.confidence = confidence
    b.slice_size = slice_size
    b.overlap = overlap


async def queue_file(
    job_id: str, saved_path: str, original_filename: str, file_type: str,
) -> str:
    batch = get_or_create_batch(job_id)
    file_id = uuid.uuid4().hex[:12]
    df = DetectionFile(
        file_id=file_id, job_id=job_id, filename=original_filename,
        path=saved_path, file_type=file_type,
    )
    batch.files[file_id] = df
    batch.total = len(batch.files)
    print(f"[DET] queue_file: {original_filename} ({file_type}) job={job_id[:8]} queue={'READY' if _queue else 'NONE'}")

    if _sio:
        await _sio.emit("detection_queued", {
            "job_id": job_id, "file_id": file_id,
            "filename": original_filename, "file_type": file_type,
            "index": batch.total,
        }, room=job_id)

    if _queue is not None:
        await _queue.put(_QItem(file=df, batch=batch))
    else:
        print("[DET] WARNING: _queue is None, file NOT queued for detection")
    return file_id


def get_batch(job_id: str) -> DetectionBatch | None:
    return _jobs.get(job_id)


def get_result_json(job_id: str, file_id: str) -> dict | None:
    p = RESULTS_ROOT / job_id / f"{file_id}.json"
    if p.exists():
        return json.loads(p.read_text())
    return None


def list_results(job_id: str) -> list[dict]:
    d = RESULTS_ROOT / job_id
    if not d.is_dir():
        return []
    out: list[dict] = []
    for p in sorted(d.glob("*.json")):
        try:
            out.append(json.loads(p.read_text()))
        except Exception:
            continue
    return out


def get_batch_status(job_id: str) -> dict | None:
    batch = _jobs.get(job_id)
    if batch is None:
        d = RESULTS_ROOT / job_id
        if d.is_dir():
            results = list_results(job_id)
            return {
                "job_id": job_id, "status": "complete",
                "total": len(results), "completed": len(results),
            }
        return None
    return {
        "job_id": job_id,
        "status": "complete" if batch.completed >= batch.total else "processing",
        "total": batch.total, "completed": batch.completed,
    }


# ── Image detection (SAHI) ───────────────────────────────────────────

def _detect_image_sync(
    path: str, conf: float, slice_size: int, overlap_ratio: float,
    progress_cb: Callable[[int, int], None] | None = None,
) -> tuple[list[dict], Any]:
    model = _load_model()
    img = cv2.imread(path)
    if img is None:
        return [], None

    h, w = img.shape[:2]
    all_dets: list[dict] = []

    full_res = model(img, conf=conf, imgsz=1024, verbose=False)
    for box in full_res[0].boxes:
        xyxy = box.xyxy[0].cpu().numpy().tolist()
        all_dets.append({
            "bbox": [round(v, 2) for v in xyxy],
            "confidence": round(float(box.conf[0]), 4),
            "class_id": int(box.cls[0]),
            "class_name": model.names[int(box.cls[0])],
            "source": "full",
        })

    stride = max(1, int(slice_size * (1 - overlap_ratio)))
    slices: list[tuple[int, int, int, int]] = []
    for y in range(0, h, stride):
        for x in range(0, w, stride):
            slices.append((x, y, min(x + slice_size, w), min(y + slice_size, h)))

    n = len(slices)
    for i, (x1, y1, x2, y2) in enumerate(slices):
        crop = img[y1:y2, x1:x2]
        if crop.size == 0:
            continue
        res = model(crop, conf=conf, imgsz=min(slice_size, 1024), verbose=False)
        for box in res[0].boxes:
            bx = box.xyxy[0].cpu().numpy()
            all_dets.append({
                "bbox": [
                    round(float(bx[0]) + x1, 2), round(float(bx[1]) + y1, 2),
                    round(float(bx[2]) + x1, 2), round(float(bx[3]) + y1, 2),
                ],
                "confidence": round(float(box.conf[0]), 4),
                "class_id": int(box.cls[0]),
                "class_name": model.names[int(box.cls[0])],
                "source": "sahi",
            })
        if progress_cb:
            progress_cb(i + 1, n)

    if len(all_dets) > 1:
        all_dets = _nms_merge(all_dets)
    return all_dets, img


# ── Video detection ──────────────────────────────────────────────────

def _detect_video_sync(
    path: str, conf: float, frame_stride: int,
    save_dir: str, file_id: str,
    progress_cb: Callable[[int, int], None] | None = None,
) -> tuple[list[dict], Any, list[dict]]:
    model = _load_model()
    save_dir_p = Path(save_dir)
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return [], None, []

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    effective_stride = max(1, min(frame_stride, total_frames // max(1, total_frames // 60)))
    sample_count = max(1, total_frames // effective_stride)

    first_frame = None
    all_dets: list[dict] = []
    frames_data: list[dict] = []
    processed = 0

    for fi in range(0, total_frames, effective_stride):
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ok, frame = cap.read()
        if not ok:
            break
        if first_frame is None:
            first_frame = frame.copy()

        res = model(frame, conf=conf, imgsz=1024, verbose=False)
        fd: list[dict] = []
        for box in res[0].boxes:
            xyxy = box.xyxy[0].cpu().numpy().tolist()
            det = {
                "bbox": [round(v, 2) for v in xyxy],
                "confidence": round(float(box.conf[0]), 4),
                "class_id": int(box.cls[0]),
                "class_name": model.names[int(box.cls[0])],
            }
            fd.append(det)
            all_dets.append(det)

        ann = _draw_annotations(frame, fd)
        fname = f"{file_id}_frame_{fi}.jpg"
        cv2.imwrite(str(save_dir_p / fname), ann, [cv2.IMWRITE_JPEG_QUALITY, 85])
        frames_data.append({
            "frame_number": fi,
            "timestamp": round(fi / fps, 2),
            "annotated_url": f"/results/{save_dir_p.name}/{fname}",
            "detection_count": len(fd),
            "detections": fd,
        })

        processed += 1
        if progress_cb:
            progress_cb(processed, sample_count)

    cap.release()
    return all_dets, first_frame, frames_data


# ── Helpers ──────────────────────────────────────────────────────────

def _nms_merge(detections: list[dict], iou_thr: float = 0.5) -> list[dict]:
    if not detections:
        return detections
    boxes = np.array([d["bbox"] for d in detections], dtype=np.float32)
    scores = np.array([d["confidence"] for d in detections], dtype=np.float32)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while len(order) > 0:
        i = order[0]
        keep.append(int(i))
        if len(order) == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        a_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        a_j = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        iou = inter / (a_i + a_j - inter + 1e-6)
        order = rest[iou <= iou_thr]
    return [detections[i] for i in keep]


def _draw_annotations(img, detections, lw=2):
    out = img.copy()
    for d in detections:
        x1, y1, x2, y2 = (int(v) for v in d["bbox"])
        c = d["confidence"]
        cls = d.get("class_name", "defect")
        color = (0, 200, 0) if c >= 0.7 else (0, 220, 255) if c >= 0.4 else (0, 80, 255)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, lw)
        label = f"{cls} {c:.0%}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(out, (x1, y1 - th - 8), (x1 + tw + 6, y1), color, -1)
        cv2.putText(out, label, (x1 + 3, y1 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def _make_thumb(img, size=THUMB_SIZE):
    h, w = img.shape[:2]
    s = min(size / w, size / h)
    return cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)


# ── Async worker ─────────────────────────────────────────────────────

async def _process_file(item: _QItem):
    f = item.file
    batch = item.batch
    loop = asyncio.get_event_loop()
    job_dir = RESULTS_ROOT / batch.job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    f.status = "processing"
    print(f"[DET] processing: {f.filename} ({f.file_type}) file_id={f.file_id}")
    if _sio:
        await _sio.emit("detection_start", {
            "job_id": batch.job_id, "file_id": f.file_id,
            "filename": f.filename, "file_type": f.file_type,
        }, room=batch.job_id)

    t0 = time.time()

    async def _emit_prog(cur, tot):
        if _sio:
            await _sio.emit("detection_progress", {
                "job_id": batch.job_id, "file_id": f.file_id,
                "current": cur, "total_steps": tot,
                "percent": min(100, int(100 * cur / max(tot, 1))),
            }, room=batch.job_id)

    def _sync_prog(cur, tot):
        try:
            asyncio.run_coroutine_threadsafe(_emit_prog(cur, tot), loop)
        except Exception:
            pass

    try:
        if f.file_type == "image":
            dets, img = await loop.run_in_executor(
                _pool, _detect_image_sync,
                f.path, batch.confidence, batch.slice_size, batch.overlap, _sync_prog,
            )
            if img is not None:
                ann = _draw_annotations(img, dets)
                aname = f"{f.file_id}_annotated.jpg"
                cv2.imwrite(str(job_dir / aname), ann, [cv2.IMWRITE_JPEG_QUALITY, 92])
                thumb = _make_thumb(ann)
                tname = f"{f.file_id}_thumb.jpg"
                cv2.imwrite(str(job_dir / tname), thumb, [cv2.IMWRITE_JPEG_QUALITY, 85])
                f.annotated_url = f"/results/{batch.job_id}/{aname}"
                f.thumb_url = f"/results/{batch.job_id}/{tname}"
                f.detections = dets

        elif f.file_type == "video":
            dets, first_frame, frames = await loop.run_in_executor(
                _pool, _detect_video_sync,
                f.path, batch.confidence, VIDEO_FRAME_STRIDE,
                str(job_dir), f.file_id, _sync_prog,
            )
            if first_frame is not None:
                best = first_frame
                for fd in frames:
                    if fd["detection_count"] > 0:
                        fp = job_dir / f"{f.file_id}_frame_{fd['frame_number']}.jpg"
                        tmp = cv2.imread(str(fp)) if fp.exists() else None
                        if tmp is not None:
                            best = tmp
                            break
                tname = f"{f.file_id}_thumb.jpg"
                cv2.imwrite(str(job_dir / tname), _make_thumb(best), [cv2.IMWRITE_JPEG_QUALITY, 85])
                f.thumb_url = f"/results/{batch.job_id}/{tname}"
            f.detections = dets
            f.frames = frames

        elapsed = int((time.time() - t0) * 1000)
        confs = [d["confidence"] for d in f.detections]
        f.status = "complete"
        f.stats = {
            "total_defects": len(f.detections),
            "avg_confidence": round(sum(confs) / len(confs), 4) if confs else 0,
            "max_confidence": round(max(confs), 4) if confs else 0,
            "min_confidence": round(min(confs), 4) if confs else 0,
            "processing_time_ms": elapsed,
        }
        if f.file_type == "video":
            f.stats["frame_count"] = len(f.frames)
            f.stats["frames_with_defects"] = sum(
                1 for fd in f.frames if fd["detection_count"] > 0
            )

        print(f"[DET] complete: {f.filename} — {len(f.detections)} detections in {elapsed}ms")
        result = {
            "file_id": f.file_id, "job_id": f.job_id,
            "filename": f.filename, "file_type": f.file_type,
            "annotated_url": f.annotated_url, "thumb_url": f.thumb_url,
            "detections": f.detections, "stats": f.stats,
        }
        if f.file_type == "video":
            result["frames"] = f.frames
        (job_dir / f"{f.file_id}.json").write_text(json.dumps(result))

        batch.completed += 1

        if _sio:
            payload = {
                "job_id": batch.job_id, "file_id": f.file_id,
                "filename": f.filename, "file_type": f.file_type,
                "thumb_url": f.thumb_url, "annotated_url": f.annotated_url,
                "stats": f.stats, "detections": f.detections,
                "completed": batch.completed, "total": batch.total,
                "batch_percent": min(100, int(100 * batch.completed / max(batch.total, 1))),
            }
            await _sio.emit("detection_result", payload, room=batch.job_id)

            if batch.completed >= batch.total:
                td = sum(len(ff.detections) for ff in batch.files.values())
                await _sio.emit("detection_batch_complete", {
                    "job_id": batch.job_id,
                    "total_files": batch.total, "total_defects": td,
                }, room=batch.job_id)

    except Exception as exc:
        import traceback
        traceback.print_exc()
        f.status = "error"
        f.stats["error"] = str(exc)
        batch.completed += 1
        if _sio:
            await _sio.emit("detection_result", {
                "job_id": batch.job_id, "file_id": f.file_id,
                "filename": f.filename, "error": str(exc),
                "completed": batch.completed, "total": batch.total,
                "batch_percent": min(100, int(100 * batch.completed / max(batch.total, 1))),
            }, room=batch.job_id)


async def _worker_loop():
    assert _queue is not None
    while True:
        item = await _queue.get()
        try:
            await _process_file(item)
        except Exception:
            import traceback
            traceback.print_exc()
        finally:
            _queue.task_done()


def start_worker() -> asyncio.Task:
    global _queue, _worker
    if _worker is not None and not _worker.done():
        return _worker
    _queue = asyncio.Queue()
    _worker = asyncio.create_task(_worker_loop(), name="detection-worker")
    return _worker


async def stop_worker():
    global _queue, _worker
    if _worker is not None:
        _worker.cancel()
        try:
            await _worker
        except asyncio.CancelledError:
            pass
        _worker = None
    _queue = None
