import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { permissionsForRoles, schemas, type RoleKey } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validateBody } from '../../core/validate.js';
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js';
import { auditContext } from '../audit/audit.service.js';
import * as authService from './auth.service.js';

/** Brute-force protection on the credential endpoint. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } },
});

export const authRouter: Router = Router();

authRouter.post(
  '/login',
  loginLimiter,
  validateBody(schemas.loginRequest),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as schemas.LoginRequest;
    res.json(await authService.login(email, password, auditContext(req)));
  }),
);

authRouter.post(
  '/refresh',
  validateBody(schemas.refreshRequest),
  asyncHandler(async (req, res) => {
    res.json(await authService.refresh((req.body as schemas.RefreshRequest).refreshToken));
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    await authService.logout(principal.userId, (req.body as { refreshToken?: string })?.refreshToken);
    res.status(204).send();
  }),
);

/** The client bootstraps its permission-aware navigation from this. */
authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    res.json({
      userId: String(principal.userId),
      tenantId: String(principal.tenantId),
      email: principal.email,
      name: principal.name,
      roleKeys: principal.roleKeys,
      permissions: permissionsForRoles(principal.roleKeys as RoleKey[]),
      companyIds: principal.companyIds.map(String),
      locationIds: principal.locationIds.map(String),
      departmentIds: principal.departmentIds.map(String),
    });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  validateBody(schemas.changePasswordRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const { currentPassword, newPassword } = req.body as schemas.ChangePasswordRequest;
    await authService.changePassword(principal.userId, currentPassword, newPassword, auditContext(req));
    res.status(204).send();
  }),
);
