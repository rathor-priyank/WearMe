#!/usr/bin/env bash
set -euo pipefail

echo "==> Setting up WearMe (VirtualTryOn) local development environment..."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm..."
  npm install -g pnpm
fi

echo "==> Installing Node workspace dependencies..."
pnpm install

echo "==> Setting up Python virtualenv in apps/ai/.venv..."
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3.11 || command -v python3)}"
"$PYTHON_BIN" -m venv apps/ai/.venv
apps/ai/.venv/bin/pip install --upgrade pip
apps/ai/.venv/bin/pip install -r apps/ai/requirements.txt -r apps/ai/requirements-dev.txt

echo "==> Copying environment files if missing..."
[ -f .env ] || cp .env.example .env
[ -f apps/ai/.env ] || cp apps/ai/.env.example apps/ai/.env
[ -f apps/web/.env.local ] || echo "NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1" > apps/web/.env.local

echo "==> Starting PostgreSQL via Docker Compose..."
docker compose -f docker/docker-compose.yml up -d

echo "==> Building shared & database packages and running migrations..."
pnpm --filter @wearme/shared build
pnpm --filter @wearme/database build
pnpm --filter @wearme/database migrate:deploy

echo "✅ Setup complete! Run 'pnpm dev' to start all services."

