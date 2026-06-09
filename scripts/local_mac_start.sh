#!/bin/bash
set -e
cd "$(dirname "$0")/.."
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Desktop is required. Install/open Docker Desktop, then run again."
  open -a "Docker" 2>/dev/null || true
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop..."
  open -a "Docker" || true
  for i in {1..60}; do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 2
  done
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not ready yet. Open Docker Desktop and try again."
  exit 1
fi
if [ ! -f .env ]; then
  cp .env.local.mac.example .env
fi
echo "Building and starting Operations Command Center..."
docker compose up -d --build
for i in {1..90}; do
  if curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done
open http://localhost:3000/login
echo "Open: http://localhost:3000/login"
echo "Login: caryl@example.com / password from LOCAL_SEED_PASSWORD (default command123)"
