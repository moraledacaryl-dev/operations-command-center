# Multi-Department Login Pass

## Decision
Login should be per person, not per department.

A user can belong to one or more departments. Their workspaces and filters follow those department memberships.

## Why
Shared department logins hide accountability. Person-based login lets the Command Center record who created, reviewed, assigned, commented, or approved something.

## Added
- `user_departments` membership table.
- Starter login endpoint.
- Personal login page.
- Auto landing after login.
- Department switcher for multi-department users.
- Department workspace endpoint/page.
- Department-aware dashboard/module filtering.

## Landing Rules
- Owner/admin/manager: Home.
- Staff/lead with department membership: Department workspace.
- Multi-department user: primary department first, switcher available.

## Future Staff App Connection
The future Staff App should use the same employee/user identity and department memberships so submissions, task updates, acknowledgements, comments, and approvals connect to the correct person.
