# Full-site screenshot audit

The browser verification suite generates deterministic screenshots into `frontend/test-results/ui-audit/` and uploads them through the existing `ui-audit-screenshots` GitHub Actions artifact.

Coverage includes:

- Public login at desktop and 390px mobile widths.
- Every private application route under the Owner role at desktop and mobile widths.
- Representative authorized surfaces for Admin, Manager, Supervisor, and Staff at desktop and mobile widths.
- The existing Marketing creation and Annotation Studio repaired-state screenshots remain unchanged and continue to validate the generic MIME/blob CSP regression.

The full-site inventory deliberately uses the same API response shapes as the accessibility regression suite so screenshots are deterministic, do not depend on production data, and remain safe to retain as CI artifacts.

Run locally from `frontend/` with:

```bash
npx playwright test --config=playwright.config.ts full-site-screenshot-inventory.spec.ts ui-screenshot-audit.spec.ts
```

The CI artifact includes all `test-results/ui-audit/*.png` files and is retained for seven days.
