# Mac local open guide

Use **Open Operations Command Center.command** first. It opens Terminal, starts Docker, builds the app, and opens the login page.

Login for local testing:

- Email: `caryl@example.com`
- Password: value from `LOCAL_SEED_PASSWORD` in `.env.local.mac.example` or `.env`

Files:

- `Operations Command Center.app` - double-click app wrapper.
- `Open Operations Command Center.command` - most reliable launcher with visible logs.
- `Stop Operations Command Center.command` - stops local containers but keeps data.
- `Reset Local Data.command` - deletes local data and recreates seed data on next launch.

Requirement: Docker Desktop for Mac.
