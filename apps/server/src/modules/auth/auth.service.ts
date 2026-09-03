import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { permissionsForRoles, type LoginResponse, type RoleKey } from '@fpc/shared';
import { ApiError } from '../../core/errors.js';
import { User } from '../../models/user.model.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import {
  accessTokenTtlSeconds,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './token.service.js';

const BCRYPT_ROUNDS = 12;
/** How long an invite stays usable before an administrator must reissue it. */
export const INVITE_TTL_MS = 7 * 86_400_000;
/** Cap on concurrent sessions per user, so the stored hash list stays bounded. */
const MAX_ACTIVE_REFRESH_TOKENS = 5;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function login(
  email: string,
  password: string,
  context: AuditContext,
): Promise<LoginResponse> {
  const user = await User.findOne({ email: email.toLowerCase() })
    .select('+passwordHash +refreshTokenHashes')
    .exec();

  // Compare against a dummy hash when the user is unknown, so a missing
  // account and a wrong password take the same time to answer.
  const passwordHash =
    user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const passwordMatches = await bcrypt.compare(password, passwordHash);

  if (!user || !passwordMatches) {
    throw ApiError.unauthorized('Incorrect email or password');
  }
  if (user.status !== 'ACTIVE') {
    throw ApiError.forbidden('This account is not active. Contact your administrator.');
  }

  const tokens = await issueTokens(user);
  user.lastLoginAt = new Date();
  await user.save();

  await audit.record(
    {
      event: 'auth.login',
      entityType: 'AUTH',
      entityId: user._id,
      entityLabel: user.email,
      tenantId: user.tenantId,
    },
    { ...context, principal: toPrincipalLike(user) },
  );

  return tokens;
}

export async function refresh(refreshToken: string): Promise<LoginResponse> {
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Refresh token is invalid or expired');
  }

  const user = await User.findById(claims.sub).select('+refreshTokenHashes').exec();
  if (!user || user.status !== 'ACTIVE') throw ApiError.unauthorized('Session is no longer valid');

  const presented = hashToken(refreshToken);
  const stored = user.refreshTokenHashes.find((entry) => entry.hash === presented);
  if (!stored || stored.expiresAt.getTime() < Date.now()) {
    throw ApiError.unauthorized('Session is no longer valid');
  }

  // Rotate: the presented token is consumed and replaced.
  user.refreshTokenHashes = user.refreshTokenHashes.filter((entry) => entry.hash !== presented);
  return issueTokens(user);
}

export async function logout(userId: Types.ObjectId, refreshToken?: string): Promise<void> {
  const user = await User.findById(userId).select('+refreshTokenHashes').exec();
  if (!user) return;
  user.refreshTokenHashes = refreshToken
    ? user.refreshTokenHashes.filter((entry) => entry.hash !== hashToken(refreshToken))
    : [];
  await user.save();
}

/**
 * Issues a single-use invite token for a user who cannot sign in yet.
 *
 * Returned in plaintext exactly once, to whoever is inviting them; only the
 * hash is stored, so a database leak cannot be used to claim an account.
 */
export async function issueInviteToken(userId: Types.ObjectId): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await User.updateOne(
    { _id: userId },
    {
      inviteTokenHash: hashToken(token),
      inviteTokenExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
      status: 'INVITED',
    },
  );
  return token;
}

/**
 * Redeems an invite: sets the password and activates the account.
 *
 * Without this an INVITED user was permanently locked out — login refuses any
 * status other than ACTIVE, and every other route requires a token they could
 * never obtain.
 */
export async function acceptInvite(
  token: string,
  password: string,
  context: AuditContext,
): Promise<LoginResponse> {
  const user = await User.findOne({ inviteTokenHash: hashToken(token) })
    .select('+passwordHash +refreshTokenHashes +inviteTokenHash +inviteTokenExpiresAt')
    .exec();

  if (!user || !user.inviteTokenExpiresAt || user.inviteTokenExpiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('This invitation is invalid or has expired. Ask for a new one.');
  }

  user.passwordHash = await hashPassword(password);
  user.status = 'ACTIVE';
  // Single use: the token cannot be replayed to seize the account later.
  user.inviteTokenHash = undefined;
  user.inviteTokenExpiresAt = undefined;
  user.refreshTokenHashes = [];

  const tokens = await issueTokens(user);
  user.lastLoginAt = new Date();
  await user.save();

  await audit.record(
    {
      event: 'auth.invite_accepted',
      entityType: 'AUTH',
      entityId: user._id,
      entityLabel: user.email,
      tenantId: user.tenantId,
    },
    { ...context, principal: toPrincipalLike(user) },
  );

  return tokens;
}

export async function changePassword(
  userId: Types.ObjectId,
  currentPassword: string,
  newPassword: string,
  context: AuditContext,
): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash +refreshTokenHashes').exec();
  if (!user) throw ApiError.notFound('User');

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw ApiError.badRequest('Current password is incorrect');
  }

  user.passwordHash = await hashPassword(newPassword);
  // Changing a password ends every other session.
  user.refreshTokenHashes = [];
  await user.save();

  await audit.record(
    {
      event: 'auth.password_changed',
      entityType: 'AUTH',
      entityId: user._id,
      entityLabel: user.email,
      tenantId: user.tenantId,
    },
    context,
  );
}

async function issueTokens(user: InstanceType<typeof User>): Promise<LoginResponse> {
  const userId = String(user._id);
  const tenantId = String(user.tenantId);
  const roleKeys = user.roleKeys as RoleKey[];

  const accessToken = signAccessToken({
    sub: userId,
    tenantId,
    email: user.email,
    name: user.name,
    roleKeys,
    companyIds: user.companyIds.map(String),
    locationIds: user.locationIds.map(String),
    departmentIds: user.departmentIds.map(String),
  });

  const { token: refreshToken } = signRefreshToken(userId, tenantId);
  const expiresAt = new Date(Date.now() + parseTtlMs(process.env.JWT_REFRESH_TTL ?? '7d'));

  user.refreshTokenHashes = [
    ...user.refreshTokenHashes.filter((entry) => entry.expiresAt.getTime() > Date.now()),
    { hash: hashToken(refreshToken), expiresAt, createdAt: new Date() },
  ].slice(-MAX_ACTIVE_REFRESH_TOKENS);
  await user.save();

  return {
    accessToken,
    refreshToken,
    expiresIn: accessTokenTtlSeconds(),
    user: {
      userId,
      tenantId,
      email: user.email,
      name: user.name,
      roleKeys,
      permissions: permissionsForRoles(roleKeys),
      companyIds: user.companyIds.map(String),
      locationIds: user.locationIds.map(String),
      departmentIds: user.departmentIds.map(String),
    },
  };
}

function parseTtlMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return 7 * 86_400_000;
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * multiplier;
}

function toPrincipalLike(user: InstanceType<typeof User>) {
  return {
    userId: user._id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    roleKeys: user.roleKeys as RoleKey[],
    permissions: permissionsForRoles(user.roleKeys as RoleKey[]),
    companyIds: user.companyIds,
    locationIds: user.locationIds,
    departmentIds: user.departmentIds,
  };
}
