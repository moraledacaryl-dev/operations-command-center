# UI v3 Pass 4 — Decisions, content, and activity

Scope: Review, Approvals, Marketing, Annotation Studio, Notifications, and History.

This pass changes presentation only. It preserves canonical decision boundaries, Marketing workflow/version behavior, Annotation Studio image handling, notification actions, archive filtering, authorization, APIs, and backend state machines.

Annotation Studio keeps its dedicated canvas/tool architecture; this pass does not alter its image decoding, Blob handling, version save flow, or CSP requirements.

Validation requires the full backend/frontend/browser CI matrix and screenshot inventory before merge.
