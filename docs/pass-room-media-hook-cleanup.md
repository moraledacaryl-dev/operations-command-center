# Room media hook warning cleanup

This pass closes the two React `exhaustive-deps` warnings introduced with Owner-managed room media.

- `rooms/[id]`: stabilize `loadMedia` with `useCallback` and declare the effect dependency explicitly.
- `rooms`: stabilize `loadMedia` and `load` with `useCallback`, then depend on `load` from the initial-load effect.

No route, API, authorization, migration, workflow, data model, or visual behavior changes are intended. The release gate remains the full backend/frontend/browser verification suite.
