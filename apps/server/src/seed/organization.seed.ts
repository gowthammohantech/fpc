import { Types } from 'mongoose';
import { normalizeName, type Permission } from '@fpc/shared';
import { ApprovalRule } from '../models/approvalRule.model.js';
import { BankAccount } from '../models/bankAccount.model.js';
import { Company } from '../models/company.model.js';
import { Department } from '../models/department.model.js';
import { Location } from '../models/location.model.js';
import { Role } from '../models/role.model.js';
import { Tenant } from '../models/tenant.model.js';
import { User } from '../models/user.model.js';
import { Vendor } from '../models/vendor.model.js';
import { hashPassword } from '../modules/auth/auth.service.js';
import { invalidateRoleCache } from '../modules/organization/role.service.js';
import { APPROVAL_RULES, type ConditionRef } from './data.approvals.js';
import {
  BANK_ACCOUNTS,
  COMPANIES,
  DEMO_PASSWORD,
  DEPARTMENTS,
  LOCATIONS,
  ROLES,
  TENANT,
  USERS,
  VENDORS,
} from './data.org.js';
import { buildActors, keyOf, type SeedContext, type SeedUser } from './context.js';

/**
 * Master data: tenant, companies, locations, roles, users, departments,
 * vendors, bank accounts and approval rules.
 *
 * Ordering is load-bearing. Departments carry a head, so users come first;
 * approval rules resolve vendor, location and department references and may
 * name a specific approver, so they come last.
 */
export async function seedOrganization(): Promise<SeedContext> {
  const tenant = await Tenant.findOneAndUpdate(
    { slug: TENANT.slug },
    { ...TENANT, active: true },
    { upsert: true, new: true },
  );
  const tenantId = tenant._id;

  const companyIds: Record<string, Types.ObjectId> = {};
  for (const definition of COMPANIES) {
    const company = await Company.findOneAndUpdate(
      { tenantId, name: definition.name },
      { ...definition, tenantId, baseCurrency: 'INR', active: true },
      { upsert: true, new: true },
    );
    companyIds[definition.key] = company._id;
  }

  const locationIds: Record<string, Types.ObjectId> = {};
  for (const definition of LOCATIONS) {
    const companyId = companyIds[definition.company]!;
    const location = await Location.findOneAndUpdate(
      { tenantId, companyId, code: definition.code },
      { ...definition, tenantId, companyId, active: true },
      { upsert: true, new: true },
    );
    locationIds[keyOf(definition.company, definition.code)] = location._id;
  }

  // Roles before users, so a user can hold one of the tenant's own roles.
  for (const definition of ROLES) {
    await Role.findOneAndUpdate(
      { tenantId, key: definition.key },
      {
        tenantId,
        key: definition.key,
        label: definition.label,
        description: definition.description,
        permissions: definition.permissions as Permission[],
        active: true,
      },
      { upsert: true, new: true },
    );
  }
  // The grant cache has a 30s TTL and would otherwise serve the empty map it
  // read before these rows existed.
  invalidateRoleCache(tenantId);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users: Record<string, SeedUser> = {};
  for (const definition of USERS) {
    const scopedCompanyIds = definition.companies.map((key) => companyIds[key]!);
    const user = await User.findOneAndUpdate(
      { tenantId, email: definition.email },
      {
        tenantId,
        name: definition.name,
        email: definition.email,
        // An invited account has no usable password until the invite is
        // accepted; giving it the demo hash would let it sign in.
        passwordHash:
          definition.status === 'INVITED' ? await hashPassword(randomSecret()) : passwordHash,
        roleKeys: definition.roles,
        companyIds: scopedCompanyIds,
        locationIds: (definition.locations ?? []).map((key) => locationIds[key]!),
        status: definition.status ?? 'ACTIVE',
      },
      { upsert: true, new: true },
    );
    users[definition.email] = {
      id: user._id,
      name: definition.name,
      email: definition.email,
      roleKeys: definition.roles,
      companyIds: scopedCompanyIds,
    };
  }

  const departmentIds: Record<string, Types.ObjectId> = {};
  for (const definition of DEPARTMENTS) {
    const companyId = companyIds[definition.company]!;
    const department = await Department.findOneAndUpdate(
      { tenantId, companyId, code: definition.code },
      {
        tenantId,
        companyId,
        name: definition.name,
        code: definition.code,
        headUserId: definition.head ? users[definition.head]?.id : undefined,
        active: true,
      },
      { upsert: true, new: true },
    );
    departmentIds[keyOf(definition.company, definition.code)] = department._id;
  }

  const vendorIds: Record<string, Types.ObjectId> = {};
  for (const definition of VENDORS) {
    const companyId = companyIds[definition.company]!;
    const vendor = await Vendor.findOneAndUpdate(
      { tenantId, companyId, code: definition.code },
      {
        ...definition,
        tenantId,
        companyId,
        status: definition.status ?? 'ACTIVE',
        // `nameNormalized` is required and is otherwise only set by a document
        // `pre('validate')` hook, which an upsert never runs. Without it the
        // extractor cannot resolve an emailed invoice to its vendor master.
        nameNormalized: normalizeName(definition.name),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    vendorIds[keyOf(definition.company, definition.code)] = vendor._id;
  }

  const bankAccountIds: Record<string, Types.ObjectId> = {};
  for (const definition of BANK_ACCOUNTS) {
    const companyId = companyIds[definition.company]!;
    const account = await BankAccount.findOneAndUpdate(
      { tenantId, companyId, accountNumber: definition.accountNumber },
      { ...definition, tenantId, companyId, balanceAsOf: new Date(), active: true },
      { upsert: true, new: true },
    );
    bankAccountIds[definition.key] = account._id;
  }

  const resolve = (ref: ConditionRef): Types.ObjectId => {
    const table =
      ref.kind === 'vendor' ? vendorIds : ref.kind === 'location' ? locationIds : departmentIds;
    const id = table[ref.key];
    if (!id) throw new Error(`seed: approval rule references unknown ${ref.kind} ${ref.key}`);
    return id;
  };

  for (const definition of APPROVAL_RULES) {
    const companyId = companyIds[definition.company]!;
    await ApprovalRule.findOneAndUpdate(
      { tenantId, companyId, name: definition.name },
      {
        tenantId,
        companyId,
        name: definition.name,
        description: definition.description,
        appliesTo: definition.appliesTo,
        priority: definition.priority,
        active: definition.active ?? true,
        conditions: definition.conditions.map(({ field, operator, value, ref }) => ({
          field,
          operator,
          value: ref ? String(resolve(ref)) : value,
        })),
        steps: definition.steps.map(({ userEmail, ...step }) => ({
          ...step,
          userId: userEmail ? users[userEmail]?.id : undefined,
        })),
      },
      { upsert: true, new: true },
    );
  }

  return {
    tenantId,
    companyIds,
    locationIds,
    departmentIds,
    vendorIds,
    bankAccountIds,
    users,
    actors: await buildActors(tenantId, users),
  };
}

/** An unusable password for an invited account, so it cannot be signed into. */
function randomSecret(): string {
  return `invited-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}
