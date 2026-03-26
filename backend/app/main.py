"""DeepThink UI — FastAPI entry point."""

import time
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.calendar import router as calendar_router
from app.api.files import router as files_router
from app.api.routes import router
from app.api.ws import router as ws_router
from app.core.config import settings
from app.db.calendar import init_calendar_db
from app.db.database import init_db


# ── Simple in-memory rate limiter ──

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Token bucket rate limiter per client IP."""

    def __init__(self, app, max_requests: int = 30, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window = window_seconds
        self._buckets: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        # Only rate-limit POST /api/chat (the expensive LLM endpoint)
        if request.method == "POST" and request.url.path == "/api/chat":
            ip = request.client.host if request.client else "unknown"
            now = time.time()
            bucket = self._buckets[ip]
            # Evict old entries
            self._buckets[ip] = [t for t in bucket if now - t < self.window]
            if len(self._buckets[ip]) >= self.max_requests:
                return Response(
                    content='{"detail":"Слишком много запросов. Подождите минуту."}',
                    status_code=429,
                    media_type="application/json",
                )
            self._buckets[ip].append(now)
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await init_calendar_db()
    yield


app = FastAPI(
    title="DeepThink UI",
    description="Personal LLM Web UI with advanced reasoning engine",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(RateLimitMiddleware, max_requests=30, window_seconds=60)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(router)
app.include_router(ws_router)
app.include_router(calendar_router)
app.include_router(files_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
