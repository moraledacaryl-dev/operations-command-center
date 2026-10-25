"""Read only the root-owned, sanitized snapshot status; never read archives."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re

STATUS_PATH = Path('/var/lib/operations-command-center-backup/status.json')
OFFSITE_STATUS_PATH = Path('/var/lib/operations-command-center-backup/offsite-status.json')


def backup_status(path: Path = STATUS_PATH, *, now: datetime | None = None) -> dict:
    unavailable = {"status": "unknown", "last_success_at": None, "last_attempt_status": "unknown"}
    try:
        if path.is_symlink() or path.stat().st_size > 4096:
            return unavailable
        data = json.loads(path.read_text())
        attempt = data.get('last_attempt_status')
        if attempt not in {'ok', 'busy', 'failed'}:
            return unavailable
        if 'last_success_at' not in data:
            return {**unavailable, 'status': 'failed' if attempt == 'failed' else 'unknown', 'last_attempt_status': attempt}
        last = datetime.fromisoformat(data['last_success_at'])
        if last.tzinfo is None:
            return unavailable
        age = ((now or datetime.now(timezone.utc)) - last).total_seconds()
        if age < -300 or not re.fullmatch('[a-f0-9]{40}', data.get('last_success_release', '')):
            return unavailable
        status = 'failed' if attempt == 'failed' else ('stale' if age > 3900 else 'current')
        return {"status": status, "last_success_at": last.astimezone(timezone.utc).isoformat(), "last_attempt_status": attempt}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return unavailable
