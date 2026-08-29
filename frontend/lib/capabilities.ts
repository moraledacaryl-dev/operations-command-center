export type Capability =
  | 'view_all_operations'
  | 'manage_department'
  | 'make_decisions'
  | 'manage_accounts'
  | 'manage_system'
  | 'view_system_health'
  | 'manage_approvals'
  | 'view_sensitive_user_metadata'
  | 'view_integration_summary';

export function normalizeRole(role: unknown) {
  return String(role || '').trim().toLowerCase();
}

function fromNames(names: unknown[]): Record<string, boolean> {
  return Object.fromEntries(
    names.filter((name): name is string => typeof name === 'string').map(name => [name, true]),
  );
}

function trueBooleanEntries(value: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  Object.entries(value).forEach(([name, granted]) => {
    if (granted === true) out[name] = true;
  });
  return out;
}

function capabilityMap(source: unknown): Record<string, boolean> {
  if (!source) return {};
  if (Array.isArray(source)) return fromNames(source);
  if (typeof source !== 'object') return {};

  const record = source as Record<string, unknown>;
  const nested = record.capabilities;

  if (Array.isArray(nested)) return fromNames(nested);
  if (nested && typeof nested === 'object') {
    return trueBooleanEntries(nested as Record<string, unknown>);
  }

  return trueBooleanEntries(record);
}

export function hasCapability(source: unknown, capability: Capability) {
  return capabilityMap(source)[capability] === true;
}
