FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl libraqm0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --only-binary=:all: \
        --index-url https://pypi.org/simple \
        -r requirements.txt \
 && python -c "from PIL import features; assert features.check('raqm'), 'raqm missing!'"
# build libs only needed to compile Pillow with raqm on armv7
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential libraqm-dev libfreetype6-dev libjpeg-dev zlib1g-dev \
 && pip install --no-cache-dir -r requirements.txt \
 && apt-get purge -y build-essential libraqm-dev libfreetype6-dev libjpeg-dev zlib1g-dev \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

COPY app/ /app/app/
# Font files and sleeping.png must be present at /app/ (FONT_DIR default)
COPY *.ttf sleeping.png* /app/

RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8765/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765"]
