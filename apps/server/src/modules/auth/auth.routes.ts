import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { schemas } from '@fpc/shared';
import { isTest } from '../../config/env.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { query, validateBody, validateQuery } from '../../core/validate.js';
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js';
import { auditContext } from '../audit/audit.service.js';
import * as authService from './auth.service.js';
import * as outlookService from '../integrations/outlook/outlook.service.js';

/** Brute-force protection on the credential endpoint. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' },
  },
  // The integration suites sign in as every seeded role many times over from a
  // single address, which would trip the limiter and mask real assertions.
  skip: () => isTest,
});

/**
 * The OAuth callback is a plain browser redirect, so it cannot be authenticated
 * and cannot be rate-limited as tightly as a credential endpoint. This is
 * generous enough for a person retrying a consent screen and mean enough to
 * make a token-exchange oracle unattractive.
 */
const oauthCallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
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

/**
 * Redeems an invitation. Public by necessity — the caller has no session yet —
 * and rate-limited on the same budget as login.
 */
authRouter.post(
  '/accept-invite',
  loginLimiter,
  validateBody(schemas.acceptInviteRequest),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body as schemas.AcceptInviteRequest;
    res.json(await authService.acceptInvite(token, password, auditContext(req)));
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
    await authService.logout(
      principal.userId,
      (req.body as { refreshToken?: string })?.refreshToken,
    );
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
      // Already resolved by `authenticate`, custom roles included.
      permissions: principal.permissions,
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
    await authService.changePassword(
      principal.userId,
      currentPassword,
      newPassword,
      auditContext(req),
    );
    res.status(204).send();
  }),
);

/**
 * Where Microsoft returns the user after consent.
 *
 * Public by necessity: the browser arrives here mid-navigation with no
 * Authorization header. Attribution comes from the signed `state` instead, and
 * the response is always a redirect back into the application — an API error
 * page would strand the user outside it.
 */
authRouter.get(
  '/outlook/callback',
  oauthCallbackLimiter,
  validateQuery(schemas.outlookCallbackQuery),
  asyncHandler(async (req, res) => {
    const q = query<typeof schemas.outlookCallbackQuery>(req);
    const result = await outlookService.completeConnect(
      {
        ...(q.code ? { code: q.code } : {}),
        ...(q.state ? { state: q.state } : {}),
        ...(q.error ? { error: q.error } : {}),
        ...(q.error_description ? { errorDescription: q.error_description } : {}),
      },
      auditContext(req),
    );
    res.redirect(302, result.redirectTo);
  }),
);
