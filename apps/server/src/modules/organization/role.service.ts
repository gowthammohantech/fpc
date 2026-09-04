import { Types } from 'mongoose';
import {
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  isSystemRoleKey,
  permissionsForRoles,
  type Permission,
  type RoleKey,
} from '@fpc/shared';
import { Role } from '../../models/role.model.js';

/** One entry of the role catalogue, whether it came from code or from a row. */
export interface RoleDefinition {
  /** Absent for built-in roles, which have no row to address. */
  id?: string;
  key: string;
  label: string;
  description?: string;
  permissions: Permission[];
  /** Built-in roles are read-only: their grants are what the tests assert. */
  system: boolean;
  active: boolean;
}

/** Grants of the tenant's own roles, keyed by role key. */
export type CustomGrants = Record<string, Permission[]>;

interface CacheEntry {
  grants: CustomGrants;
  expiresAt: number;
}

/**
 * Custom grants are read on the authentication path, so they are cached.
 *
 * The TTL is a backstop for writes this process did not see (another replica,
 * the seed script); every write made here invalidates the tenant's entry, so
 * in the common case a permission change takes effect on the next request.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

export function invalidateRoleCache(tenantId?: Types.ObjectId | string): void {
  if (tenantId) cache.delete(String(tenantId));
  else cache.clear();
}

export async function customGrants(tenantId: Types.ObjectId | string): Promise<CustomGrants> {
  const key = String(tenantId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.grants;

  const roles = await Role.find({ tenantId: new Types.ObjectId(key), active: true })
    .select('key permissions')
    .lean();

  const grants: CustomGrants = {};
  for (const role of roles) grants[role.key] = role.permissions as Permission[];

  cache.set(key, { grants, expiresAt: Date.now() + CACHE_TTL_MS });
  return grants;
}

/**
 * Resolves a user's effective permissions.
 *
 * Skips the database entirely when every role is built in, which is the case
 * for every seeded account and so for most requests.
 */
export async function resolvePermissions(
  tenantId: Types.ObjectId | string,
  roleKeys: readonly string[],
): Promise<Permission[]> {
  if (roleKeys.every(isSystemRoleKey)) return permissionsForRoles(roleKeys);
  return permissionsForRoles(roleKeys, await customGrants(tenantId));
}

/** The built-in roles, in the order PRD §7 lists them. */
export function systemRoles(): RoleDefinition[] {
  return ROLE_KEYS.map((key) => ({
    key,
    label: ROLE_LABELS[key as RoleKey],
    permissions: ROLE_PERMISSIONS[key as RoleKey],
    system: true,
    active: true,
  }));
}

/** Built-in roles followed by the tenant's own, for the settings screen. */
export async function roleCatalogue(tenantId: Types.ObjectId | string): Promise<RoleDefinition[]> {
  const custom = await Role.find({ tenantId: new Types.ObjectId(String(tenantId)) })
    .sort({ label: 1 })
    .lean();

  return [
    ...systemRoles(),
    ...custom.map((role) => ({
      id: String(role._id),
      key: role.key,
      label: role.label,
      ...(role.description ? { description: role.description } : {}),
      permissions: role.permissions as Permission[],
      system: false,
      active: role.active,
    })),
  ];
}

/** Role keys that exist for this tenant — used to validate user assignments. */
export async function knownRoleKeys(tenantId: Types.ObjectId | string): Promise<Set<string>> {
  const custom = await Role.find({ tenantId: new Types.ObjectId(String(tenantId)) })
    .select('key')
    .lean();
  return new Set<string>([...ROLE_KEYS, ...custom.map((role) => role.key)]);
}

/**
 * Turns a role name into a key, e.g. "Payments Clerk" → PAYMENTS_CLERK.
 *
 * Only used when the caller did not supply one; a collision is reported by the
 * route rather than silently resolved, so the administrator picks the key.
 */
export function deriveRoleKey(label: string): string {
  return (
    label
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'ROLE'
  );
}
