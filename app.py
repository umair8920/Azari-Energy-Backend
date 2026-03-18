"""
Azari Energy Backend - FastAPI application entry point.
"""
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI

from middleware.cors import setup_cors

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown hooks."""
    yield


app = FastAPI(
    title="Azari Energy API",
    description="Backend API for Azari Energy",
    version="0.1.0",
    lifespan=lifespan,
)

setup_cors(app)


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint for load balancers and monitoring."""
    return {"status": "healthy", "service": "azari-energy-api"}


# Mount API routers when implemented (e.g. auth)
# from api.auth.routes import router as auth_router
# app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
