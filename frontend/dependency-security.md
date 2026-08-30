# Dependency security closure

Final production dependency audit on 2026-08-30 identified high-severity transitive advisories in Nano ID, PostCSS, and sharp while the application was otherwise fully certified.

This pass pins patched transitive versions through npm overrides and regenerates the lockfile reproducibly on Node 20.19.5. The temporary lockfile-refresh workflow removes itself after committing the regenerated lockfile.

Acceptance requires the existing backend, frontend, migration, browser, and accessibility gates plus zero high/critical findings from both production-only and full-tree npm audit checks.
