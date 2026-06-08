#!/bin/bash
set -e
cd "$(dirname "$0")/.."
echo "This deletes local Command Center containers, volumes, uploads, and test data."
read -p "Type RESET to continue: " ans
if [ "$ans" != "RESET" ]; then echo "Cancelled"; exit 0; fi
docker compose down -v --remove-orphans
rm -rf backend/uploads/*
touch backend/uploads/.gitkeep
echo "Reset done. Run Open Operations Command Center.command again."
