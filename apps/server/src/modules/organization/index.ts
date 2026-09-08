import { Router } from 'express';
import { BusinessUnitKind, schemas, normalizeName } from '@fpc/shared';
import { Location } from '../../models/location.model.js';
import { Department } from '../../models/department.model.js';
import { Group } from '../../models/group.model.js';
import { Region } from '../../models/region.model.js';
import { Vertical } from '../../models/vertical.model.js';
import { BusinessUnit } from '../../models/businessUnit.model.js';
import { Vendor } from '../../models/vendor.model.js';
import { BankAccount } from '../../models/bankAccount.model.js';
import { crudRouter } from './crudFactory.js';
import { companyRouter } from './company.routes.js';
import { roleRouter } from './role.routes.js';
import { userRouter } from './user.routes.js';

const groupRouter = crudRouter({
  model: Group,
  entityType: 'GROUP',
  name: 'group',
  permissions: {
    read: 'group:read',
    create: 'group:create',
    update: 'group:update',
    delete: 'group:delete',
  },
  createSchema: schemas.createGroupRequest,
  updateSchema: schemas.updateGroupRequest,
  // A group sits above the legal entity, so it has no company of its own.
  tenantScoped: true,
});

const regionRouter = crudRouter({
  model: Region,
  entityType: 'REGION',
  name: 'region',
  permissions: {
    read: 'region:read',
    create: 'region:create',
    update: 'region:update',
    delete: 'region:delete',
  },
  createSchema: schemas.createRegionRequest,
  updateSchema: schemas.updateRegionRequest,
  selfScopeAxis: 'regionId',
});

const verticalRouter = crudRouter({
  model: Vertical,
  entityType: 'VERTICAL',
  name: 'vertical',
  permissions: {
    read: 'vertical:read',
    create: 'vertical:create',
    update: 'vertical:update',
    delete: 'vertical:delete',
  },
  createSchema: schemas.createVerticalRequest,
  updateSchema: schemas.updateVerticalRequest,
  selfScopeAxis: 'verticalId',
});

const businessUnitRouter = crudRouter({
  model: BusinessUnit,
  entityType: 'BUSINESS_UNIT',
  name: 'business_unit',
  permissions: {
    read: 'business_unit:read',
    create: 'business_unit:create',
    update: 'business_unit:update',
    delete: 'business_unit:delete',
  },
  createSchema: schemas.createBusinessUnitRequest,
  updateSchema: schemas.updateBusinessUnitRequest,
  selfScopeAxis: 'businessUnitId',
  // A classified unit is reachable only by naming it in your own scope, so
  // holding the vertical above it is not enough. Administrators who maintain
  // the master still see them, or they could not be edited at all.
  extraScope: (principal) =>
    principal.businessUnitIds.length > 0 || principal.permissions.includes('business_unit:update')
      ? {}
      : { kind: BusinessUnitKind.STANDARD },
  buildFilter: (q) => (q.verticalId ? { verticalId: q.verticalId } : {}),
});

const locationRouter = crudRouter({
  model: Location,
  entityType: 'LOCATION',
  name: 'location',
  permissions: {
    read: 'location:read',
    create: 'location:create',
    update: 'location:update',
    delete: 'location:delete',
  },
  createSchema: schemas.createLocationRequest,
  updateSchema: schemas.updateLocationRequest,
  selfScopeAxis: 'locationId',
});

const departmentRouter = crudRouter({
  model: Department,
  entityType: 'DEPARTMENT',
  name: 'department',
  permissions: {
    read: 'department:read',
    create: 'department:create',
    update: 'department:update',
    delete: 'department:delete',
  },
  createSchema: schemas.createDepartmentRequest,
  updateSchema: schemas.updateDepartmentRequest,
  selfScopeAxis: 'departmentId',
});

const vendorRouter = crudRouter({
  model: Vendor,
  entityType: 'VENDOR',
  name: 'vendor',
  permissions: {
    read: 'vendor:read',
    create: 'vendor:create',
    update: 'vendor:update',
    delete: 'vendor:delete',
  },
  createSchema: schemas.createVendorRequest,
  updateSchema: schemas.updateVendorRequest,
  buildFilter: (q) => (q.status ? { status: q.status } : {}),
  beforeCreate: async (payload) => ({
    ...payload,
    nameNormalized: normalizeName(String(payload.name)),
    // Vendor codes are optional on input; derive a stable one when absent.
    code: payload.code ?? deriveVendorCode(String(payload.name)),
  }),
});

const bankAccountRouter = crudRouter({
  model: BankAccount,
  entityType: 'BANK_ACCOUNT',
  name: 'bank_account',
  permissions: {
    read: 'bank_account:read',
    create: 'bank_account:create',
    update: 'bank_account:update',
    delete: 'bank_account:delete',
  },
  createSchema: schemas.createBankAccountRequest,
  updateSchema: schemas.updateBankAccountRequest,
  defaultSort: { label: 1 },
  label: (doc) => String(doc.label),
});

function deriveVendorCode(name: string): string {
  const base = normalizeName(name).replace(/\s+/g, '').toUpperCase().slice(0, 8) || 'VENDOR';
  return `${base}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

export const organizationRouter: Router = Router();
organizationRouter.use('/companies', companyRouter);
organizationRouter.use('/groups', groupRouter);
organizationRouter.use('/regions', regionRouter);
organizationRouter.use('/verticals', verticalRouter);
organizationRouter.use('/business-units', businessUnitRouter);
organizationRouter.use('/locations', locationRouter);
organizationRouter.use('/departments', departmentRouter);
organizationRouter.use('/users', userRouter);
organizationRouter.use('/roles', roleRouter);
organizationRouter.use('/vendors', vendorRouter);
organizationRouter.use('/bank-accounts', bankAccountRouter);
