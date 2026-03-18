"""
CORS middleware configuration. Reads allowed frontend origin(s) from .env.
"""
import os
from fastapi.middleware.cors import CORSMiddleware


def get_cors_origins():
    """
    Read frontend URL(s) from environment. Supports comma-separated list.
    Defaults to ['http://localhost:3000'] if FRONTEND_URL is not set.
    """
    raw = os.getenv("FRONTEND_URL", "http://localhost:3000").strip()
    if not raw:
        return ["http://localhost:3000"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def setup_cors(app):
    """Add CORS middleware to the FastAPI app using FRONTEND_URL from .env."""
    origins = get_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
