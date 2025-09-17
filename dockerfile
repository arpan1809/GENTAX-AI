# syntax=docker/dockerfile:1

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only requirements first to leverage Docker layer cache
COPY requirements.txt /app/requirements.txt

RUN pip install --upgrade pip \
 && pip install -r /app/requirements.txt

# Copy application code
COPY . /app

# Create a non-root user
RUN useradd -m appuser \
 && chown -R appuser:appuser /app
USER appuser

# Environment defaults
ENV HOST=0.0.0.0 \
    PORT=8000 \
    GROQ_MODEL=llama-3.1-8b-instant

# Expose API port
EXPOSE 8000

# Healthcheck (simple HTTP GET)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
 CMD curl -fsS http://localhost:8000/api/health || exit 1

# Run the FastAPI app
# main.py starts uvicorn in __main__, but we prefer explicit uvicorn entrypoint
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
