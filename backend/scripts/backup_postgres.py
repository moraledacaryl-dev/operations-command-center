"""Create an atomic PostgreSQL backup without exposing credentials in process arguments."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlalchemy.engine import make_url


def backup_postgres(database_url: str, destination: Path) -> None:
    url = make_url(database_url)
    if url.get_backend_name() != "postgresql":
        raise ValueError("Production DATABASE_URL must use PostgreSQL")

    # Arguments appear in process listings; never include the database password.
    # libpq accepts the password via PGPASSWORD instead.
    dump_url = url.set(drivername="postgresql", password=None).render_as_string(hide_password=False)
    child_env = os.environ.copy()
    child_env.pop("DATABASE_URL", None)
    if url.password is not None:
        child_env["PGPASSWORD"] = url.password

    # mkstemp creates a private 0600 file. Only publish a complete successful dump.
    fd, temporary = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    os.close(fd)
    try:
        subprocess.run(
            [
                "pg_dump",
                "--format=custom",
                "--no-owner",
                "--no-acl",
                f"--dbname={dump_url}",
                f"--file={temporary}",
            ],
            check=True,
            env=child_env,
        )
        if Path(temporary).stat().st_size == 0:
            raise RuntimeError("PostgreSQL backup is empty")
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: backup_postgres.py OUTPUT_FILE")
    backup_postgres(os.environ.get("DATABASE_URL", ""), Path(sys.argv[1]))
