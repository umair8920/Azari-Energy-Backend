# Azari Energy Backend – Architecture Guide

This document describes the intended architecture and folder structure of the Azari Energy FastAPI backend.

---

## High-Level Overview

- **Entry point:** `app.py` – creates the FastAPI app, applies middleware, and mounts routers.
- **API layer:** `api/` – route definitions grouped by domain (e.g. auth).
- **Business logic:** `controllers/` – request handling and orchestration.
- **Data & validation:** `models/` – Pydantic/schema models and (later) ORM models.
- **Cross-cutting:** `middleware/`, `utils/`, `plugins/` – CORS, helpers, and pluggable behavior.

Request flow: **Client → FastAPI (app.py) → Router (api/) → Controller → Response.**

---

## Project Structure

```
Azari-Energy-backend/
├── app.py                 # Application entry, health check, middleware, router mounting
├── .env                   # Local env vars (not committed)
├── .env.example           # Template for required env vars
├── requirements.txt       # Python dependencies
│
├── api/                   # API route definitions (thin layer)
│   ├── __init__.py
│   └── auth/
│       └── routes.py      # Auth-related endpoints (structure only for now)
│
├── controllers/           # Business logic / request handling
│   ├── __init__.py
│   └── auth_controller.py # Auth logic (structure only for now)
│
├── models/                # Schemas, DTOs, and (future) DB models
│   └── __init__.py
│
├── middleware/            # Custom middleware (e.g. CORS, logging)
│   ├── __init__.py
│   └── cors.py
│
├── plugins/               # Pluggable components (e.g. DB, Redis)
│   └── __init__.py
│
└── utils/                 # Shared utilities
    └── __init__.py
```

---

## Layer Responsibilities

| Layer        | Purpose |
|-------------|---------|
| **app.py**  | Create app, CORS, lifespan, mount routers, global config. |
| **api/**    | Define HTTP routes; validate input (e.g. via Pydantic); delegate to controllers. |
| **controllers/** | Implement use cases; call services/DB; return data for responses. |
| **models/** | Request/response schemas and (later) persistence models. |
| **middleware/** | Request/response processing (CORS, logging, auth checks, etc.). |
| **plugins/**   | External integrations (DB, cache, messaging). |
| **utils/**     | Reusable helpers (hashing, dates, formatting). |

---

## Key Conventions

1. **Routes** – Keep `api/*/routes.py` thin: parse request, call controller, return response.
2. **Auth** – Auth-related routes live under `api/auth/`; logic in `controllers/auth_controller.py`. Files are in place for structure; implementation is pending.
3. **Environment** – Use `.env` and `python-dotenv`; document variables in `.env.example`.
4. **Health** – A single health check is exposed at `GET /health` for load balancers and monitoring.

---

## Future Extensions

- Add more routers under `api/` (e.g. `api/users/`, `api/energy/`) and mount them in `app.py`.
- Implement auth in `api/auth/routes.py` and `controllers/auth_controller.py`.
- Use `models/` for Pydantic schemas and, if needed, SQLAlchemy or another ORM.
- Use `plugins/` for database connection, Redis, or other infra.
- Add custom middleware in `middleware/` (e.g. `middleware/cors.py`) and register it in `app.py`.

---

