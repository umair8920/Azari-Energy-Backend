from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from services import upload_queue

router = APIRouter()


class BatchStartBody(BaseModel):
    total: int = Field(gt=0, le=500)
    category: Literal["video", "rgb", "thermal"]


@router.post("/batch/start")
async def batch_start(body: BatchStartBody):
    """Declare batch size and category; returns job_id for Socket.IO room and per-file uploads."""
    job_id = await upload_queue.start_batch(body.total, body.category)
    return {"job_id": job_id}


@router.post("/file")
async def upload_file(
    job_id: str = Form(...),
    file: UploadFile = File(...),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="missing filename")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    try:
        await upload_queue.enqueue_file(job_id, file.filename, data)
    except LookupError:
        raise HTTPException(status_code=404, detail="unknown job_id") from None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return {"ok": True, "filename": file.filename}
