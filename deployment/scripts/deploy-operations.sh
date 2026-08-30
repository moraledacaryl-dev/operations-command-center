#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "NOTICE | deployment/scripts/deploy-operations.sh delegates to the canonical immutable deployment gate."
exec "$REPO_ROOT/scripts/deploy_production.sh" "$@"
