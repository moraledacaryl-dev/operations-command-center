#!/bin/sh
# One-time training initialization. This runs inside the dedicated training container only.
set -eu
umask 077

DB=/training/data/operations_training_demo_class1.sqlite
ROSTER=/training/private/accounts
MARK=/training/data/.training-seeded
export ENVIRONMENT=local
export ALLOW_DEMO_SEED=false
export ALLOW_DEFAULT_ADMIN_BOOTSTRAP=false
export DATABASE_URL=sqlite:////training/data/operations_training_demo_class1.sqlite

mkdir -p /training/data /training/uploads /training/private

if [ -e "$MARK" ]; then
    if [ ! -s "$DB" ] || [ ! -s "$ROSTER/PRIVATE_training_accounts.json" ]; then
        echo "REFUSED: incomplete training initialization; do not bypass. Review dedicated volumes." >&2
        exit 1
    fi
    echo "Previously seeded training data found; preserving all exercises."
else
    if [ -e "$DB" ]; then
        echo "REFUSED: database exists without complete marker. Manual inspection is required." >&2
        exit 1
    fi
    alembic upgrade head
    python scripts/seed_training_demo.py \
        --confirm ISOLATED_TRAINING_DATABASE_ONLY \
        --private-output "$ROSTER"
    touch "$MARK"
    echo "Created isolated synthetic Operations training database."
fi

chown -R operations:operations /training/data /training/uploads
chmod 700 /training/data /training/uploads /training/private
echo "Training initialization finished. Credentials remain in a separate private volume."
