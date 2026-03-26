"""
Azari Energy Backend - FastAPI application entry point.
Run with: uvicorn app:app --reload
(`app` is the combined ASGI app: Socket.IO + FastAPI.)
"""
import json
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates

from api.uploads.routes import router as uploads_router
from api.detection.routes import router as detection_router
from middleware.cors import setup_cors
from services import upload_queue
from services import detection
from websocket.sio import asgi_mount, sio

import websocket.events  # noqa: F401 — registers Socket.IO handlers on import

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
RESULTS_DIR = BASE_DIR / "public" / "results"
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

upload_queue.set_sio(sio)
detection.set_sio(sio)


@asynccontextmanager
async def lifespan(app: FastAPI):
    upload_queue.ensure_upload_dirs()
    detection.ensure_dirs()
    upload_queue.start_worker()
    detection.start_worker()
    yield
    await upload_queue.stop_worker()
    await detection.stop_worker()


fastapi_app = FastAPI(
    title="Azari Energy API",
    description="Backend API for Azari Energy",
    version="0.1.0",
    lifespan=lifespan,
)

setup_cors(fastapi_app)

fastapi_app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
fastapi_app.mount("/results", StaticFiles(directory=str(RESULTS_DIR)), name="results")
fastapi_app.include_router(uploads_router, prefix="/api/uploads", tags=["Uploads"])
fastapi_app.include_router(detection_router, prefix="/api/detection", tags=["Detection"])


@fastapi_app.get("/", response_class=HTMLResponse, tags=["UI"])
async def dashboard_page(request: Request):
    """Dashboard (home layout with app bar and sidebar)."""
    return templates.TemplateResponse(
        request=request,
        name="pages/dashboard/dashboard.html",
        context={"active_nav": "dashboard"},
    )


@fastapi_app.get("/ai-analysis", response_class=HTMLResponse, tags=["UI"])
async def ai_analysis_page(
    request: Request,
    tab: str | None = Query(default="video", alias="tab"),
):
    """AI Data Analysis (home layout; tab via ?tab=video|rgb|thermal)."""
    allowed = {"video", "rgb", "thermal"}
    active_tab = tab if tab in allowed else "video"
    return templates.TemplateResponse(
        request=request,
        name="pages/aiAnalysis/aianalysis.html",
        context={
            "active_nav": "ai_analysis",
            "active_tab": active_tab,
        },
    )


@fastapi_app.get("/detection/detail", response_class=HTMLResponse, tags=["UI"])
async def detection_detail_page(
    request: Request,
    job_id: str = Query(...),
    file_id: str = Query(...),
):
    """Detection result detail — opens in new window from grid."""
    result = detection.get_result_json(job_id, file_id)
    if result is None:
        raise HTTPException(404, "Detection result not found")
    return templates.TemplateResponse(
        request=request,
        name="pages/detection/detail.html",
        context={
            "result": result,
            "result_json": json.dumps(result),
        },
    )


@fastapi_app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint for load balancers and monitoring."""
    return {"status": "healthy", "service": "azari-energy-api"}


app = asgi_mount(fastapi_app)
