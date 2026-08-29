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

export type CapabilitySource =
  | { capabilities?: Record<string, boolean> | string[] | null }
  | Record<string, boolean>
  | string[]
  | null
  | undefined;

function capabilityMap(source: CapabilitySource): Record<string, boolean> {
  if (!source) return {};
  if (Array.isArray(source)) return Object.fromEntries(source.map(name => [name, true]));
  if ('capabilities' in source) {
    const nested = source.capabilities;
    if (Array.isArray(nested)) return Object.fromEntries(nested.map(name => [name, true]));
    return nested || {};
  }
  return source;
}

export function hasCapability(source: CapabilitySource, capability: Capability) {
  return capabilityMap(source)[capability] === true;
}
