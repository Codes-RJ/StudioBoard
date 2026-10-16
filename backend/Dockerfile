FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    default-libmysqlclient-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=5000

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 app \
    && useradd --uid 1000 --gid app --create-home --shell /usr/sbin/nologin app

COPY --from=builder /wheels /wheels
COPY --from=builder /app/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --no-index --find-links=/wheels --require-hashes -r requirements.txt \
    && rm -rf /wheels

COPY --chown=app:app alembic.ini ./alembic.ini
COPY --chown=app:app alembic ./alembic
COPY --chown=app:app app ./app
COPY --chown=app:app docker-entrypoint.sh job_worker.py maintenance.py reconcile_storage.py reset_admin.py role_healthcheck.py ./

RUN mkdir -p /app/uploads && chown app:app /app/uploads \
    && chmod +x /app/docker-entrypoint.sh

USER app

EXPOSE 5000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000", "--no-proxy-headers"]
