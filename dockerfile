# syntax=docker/dockerfile:1

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_ONLY_BINARY=:all:

# Install curl only (we don’t need build-essential if we avoid compiling)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first (for caching)
COPY requirements.txt /app/requirements.txt

# Upgrade pip and install deps (only from wheels)
RUN pip install --upgrade pip \
 && pip install --no-cache-dir -r /app/requirements.txt

# Copy app code
COPY . /app

# Create non-root user
RUN useradd -m appuser \
 && chown -R appuser:appuser /app
USER appuser

# Environment defaults
ENV HOST=0.0.0.0 \
    PORT=8000 \
    GROQ_MODEL=llama-3.1-8b-instant

# Expose API port
EXPOSE 8000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
 CMD curl -fsS http://localhost:8000/api/health || exit 1

# Run app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]


