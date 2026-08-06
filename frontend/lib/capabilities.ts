export type Capability =
  | 'view_all_operations'
  | 'manage_department'
  | 'make_decisions'
  | 'manage_accounts'
  | 'manage_system'
  | 'view_system_health'
  | 'manage_approvals'
  | 'view_sensitive_user_metadata';

const ROLE_CAPABILITIES: Record<string, ReadonlySet<Capability>> = {
  owner: new Set<Capability>([
    'view_all_operations', 'manage_department', 'make_decisions', 'manage_accounts',
    'manage_system', 'view_system_health', 'manage_approvals', 'view_sensitive_user_metadata',
  ]),
  admin: new Set<Capability>([
    'view_all_operations', 'manage_department', 'make_decisions', 'manage_accounts',
    'manage_system', 'view_system_health', 'manage_approvals', 'view_sensitive_user_metadata',
  ]),
  manager: new Set<Capability>([
    'view_all_operations', 'manage_department', 'make_decisions',
    'view_system_health', 'manage_approvals',
  ]),
  lead: new Set<Capability>(['manage_department']),
  supervisor: new Set<Capability>(['manage_department']),
  staff: new Set<Capability>(),
};

export function normalizeRole(role: unknown) {
  return String(role || '').trim().toLowerCase();
}

export function hasCapability(role: unknown, capability: Capability) {
  return ROLE_CAPABILITIES[normalizeRole(role)]?.has(capability) ?? false;
}

export function capabilitiesForRole(role: unknown) {
  return ROLE_CAPABILITIES[normalizeRole(role)] ?? new Set<Capability>();
}
