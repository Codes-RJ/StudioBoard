#!/bin/sh
set -e

if [ "${ALLOW_SERVER_WORKSPACE:-false}" = "true" ]; then
  mkdir -p "${UPLOAD_PATH:-/app/uploads}"
  if [ "${NODE_ENV:-development}" = "production" ] && [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    alembic -c /app/alembic.ini upgrade head
  fi
fi

exec "$@"
