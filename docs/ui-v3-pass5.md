# UI v3 Pass 5 — People, system, and account

Scope: Departments, People & Access, capability-gated approval administration entry point, System Health, Account Security, and Connected Apps presentation.

This pass changes presentation and navigation labeling only. It preserves current authorization, department workspace behavior, account/session security, archive/health behavior, canonical approval workflow, configured external app URLs, APIs, database state, and integrations.

`/admin/approve` is a legacy redirect to `/approvals`; this pass does not invent a separate approval-setup feature. The navigation label is corrected to reflect the real canonical approval administration destination.

Connected Apps remains limited to configured Staff & Payroll, POS, and Accounting URLs. No Inventory URL or unsupported destination is fabricated.

Validation requires the full backend/frontend/browser CI matrix and screenshot inventory before merge.