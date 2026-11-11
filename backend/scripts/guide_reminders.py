#!/usr/bin/env python3
"""Send due Staff Guide reminders once; designed for the systemd timer."""
from app.database import SessionLocal
from app.services.guide_reminders import send_due_reminders


def main():
    with SessionLocal() as db:
        count = send_due_reminders(db)
    print("Staff Guide reminders sent:", count)


if __name__ == "__main__":
    main()
