# Azari Energy Backend

Backend API for Azari Energy, built with **FastAPI**.

---

## Stack

| Component    | Technology        |
|-------------|--------------------|
| Framework   | FastAPI            |
| Server      | Uvicorn (ASGI)     |
| Validation  | Pydantic           |
| Env config  | python-dotenv      |
| Language    | Python 3.x         |

---

## Prerequisites

- **Python 3.10+**
- **pip** (or another package manager)

---

## Setup Guide

### 1. Clone and enter the project

```bash
git clone <repository-url>
cd Azari-Energy-backend
```

### 2. Create a virtual environment

```bash
python -m venv venv
```

**Windows (PowerShell):**

```powershell
.\venv\Scripts\Activate.ps1
```

**Windows (CMD):**

```cmd
venv\Scripts\activate.bat
```

**macOS/Linux:**

```bash
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Environment variables

Copy the example env file and fill in values:

```bash
copy .env.example .env
```

Edit `.env` with your local/config values. Do not commit `.env`.

### 5. Run the application

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

- **API base:** http://localhost:8000  
- **Health check:** http://localhost:8000/health  
- **OpenAPI docs:** http://localhost:8000/docs  
- **ReDoc:** http://localhost:8000/redoc  

---

## Project Structure (Summary)

- **app.py** – FastAPI app, middleware, health check, router mounting.
- **api/** – Route modules (e.g. `api/auth/routes.py` for auth – structure only for now).
- **controllers/** – Business logic (e.g. `auth_controller.py` – structure only).
- **models/** – Schemas and (future) DB models.
- **middelware/** – Custom middleware (e.g. CORS).
- **plugins/** – Pluggable components (DB, cache, etc.).
- **utils/** – Shared utilities.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for a detailed architecture guide.

---

## Health Check

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"healthy","service":"azari-energy-api"}
```

---

## License

Private / Internal use as per project policy.
