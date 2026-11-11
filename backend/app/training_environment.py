"""Identify the explicitly local, isolated training database."""
from pathlib import Path
import os
from sqlalchemy.orm import Session


def is_isolated_training(db: Session) -> bool:
    if os.environ.get('ENVIRONMENT', '').strip().lower() not in {'local', 'test'}:
        return False
    url = db.get_bind().url
    database = url.database or ''
    if url.get_backend_name() != 'sqlite' or not database or database == ':memory:':
        return False
    path = Path(database)
    return path.is_absolute() and path.name.startswith('operations_training_demo_') and path.suffix == '.sqlite'
