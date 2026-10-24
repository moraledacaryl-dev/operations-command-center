"""Read the current DB revision without printing connection diagnostics."""
import re
from alembic.runtime.migration import MigrationContext
from app.database import engine


def database_revision():
    with engine.connect() as connection:
        heads = MigrationContext.configure(connection).get_current_heads()
    if not heads:
        return 'unversioned'
    if len(heads) != 1 or not re.fullmatch('[a-zA-Z0-9_]+', heads[0]):
        raise ValueError('Unsupported database revision state')
    return heads[0]


if __name__ == '__main__':
    try:
        print(database_revision())
    except Exception:
        raise SystemExit('ERROR | current database revision could not be verified')
