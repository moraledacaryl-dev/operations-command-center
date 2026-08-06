# Frontend lockfile generation

Generate the canonical lockfile only from the pinned `frontend/package.json` on Node 20.18.1 and npm 10:

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install --package-lock-only
npm ci
npm run verify
```

Commit `frontend/package-lock.json`. Do not commit `node_modules`, `.next`, or environment files.

The generated build must not print `Found lockfile missing swc dependencies` or `Failed to patch lockfile`.
