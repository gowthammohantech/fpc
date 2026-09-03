import { Router } from 'express';
import { schemas, normalizeName } from '@fpc/shared';
import { Location } from '../../models/location.model.js';
import { Department } from '../../models/department.model.js';
import { Vendor } from '../../models/vendor.model.js';
import { BankAccount } from '../../models/bankAccount.model.js';
import { crudRouter } from './crudFactory.js';
import { companyRouter } from './company.routes.js';
import { roleRouter, userRouter } from './user.routes.js';

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
organizationRouter.use('/locations', locationRouter);
organizationRouter.use('/departments', departmentRouter);
organizationRouter.use('/users', userRouter);
organizationRouter.use('/roles', roleRouter);
organizationRouter.use('/vendors', vendorRouter);
organizationRouter.use('/bank-accounts', bankAccountRouter);
