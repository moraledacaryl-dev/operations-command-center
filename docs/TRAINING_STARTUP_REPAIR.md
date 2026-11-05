# Existing-installation startup repair — November 5, 2026

The installed Mac app remained at “Checking training website and database” and eventually reported that it could not open. Start training could not reach the sign-in screen. The local practice database was still at schema 0011 while the installed package required 0014.

Both desktop initializers returned early when `.initialized` existed. They refreshed sample exercises but skipped migrations. The packaged readiness checks covered fresh setup, interrupted setup and same-version restart, which did not catch this older-installation upgrade.

The shared upgrade now verifies the local fictional database and account marker, saves a private SQLite backup, and runs migrations before refreshing examples. It preserves the existing accounts and practice records. A current schema is left alone without creating a second backup. The Mac readiness wait now has a 60-second overall deadline instead of multiplying individual request waits across 90 attempts.

Two regression cases reproduced the missing migration before the correction. Six new upgrade cases and ten existing first-launch recovery cases pass locally. The new cases exercise both desktop initialization entry points against a real 0011 SQLite schema, confirm a 0014 result, compare saved practice and credentials, verify the old-schema backup, and reject nontraining settings before writes. Frozen Mac and Windows packaging checks now include an actual prior-version database upgrade.

The same upgrade was first verified on a private copy of the installed database. The installed fictional database was then backed up and upgraded. Hashes of every existing table and the private credential roster matched afterward: all 49 existing tables and practice logins were preserved. No production database was accessed.

The actual installed Mac launcher was retried through native graphical controls. Clicking Start training changed the status to “Running on this computer • Your practice is saved” and opened `http://127.0.0.1:3401/login?next=/training`. Its database, migrations, storage and security readiness checks all returned healthy. The app was left running for the user.

Graphical proof is saved locally in `artifacts/training-start-fix-20261105/start-training-working.png`. Exact-head hosted check and package results accompany the delivery; local success does not imply hosted completion.
