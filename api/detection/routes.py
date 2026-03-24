from fastapi import APIRouter, HTTPException

from services import detection

router = APIRouter()


@router.get("/status/{job_id}")
async def batch_status(job_id: str):
    info = detection.get_batch_status(job_id)
    if info is None:
        raise HTTPException(404, "Job not found")
    return info


@router.get("/results/{job_id}")
async def list_job_results(job_id: str):
    status = detection.get_batch_status(job_id)
    results = detection.list_results(job_id)
    return {
        "job_id": job_id,
        "status": status["status"] if status else "unknown",
        "total": status["total"] if status else len(results),
        "completed": status["completed"] if status else len(results),
        "results": results,
    }


@router.get("/results/{job_id}/{file_id}")
async def file_result(job_id: str, file_id: str):
    r = detection.get_result_json(job_id, file_id)
    if r is None:
        raise HTTPException(404, "Result not found")
    return r
