import type { Request } from 'express';
import { Types } from 'mongoose';
import type { EntityType } from '@fpc/shared';
import { logger } from '../../config/logger.js';
import { AuditEvent } from '../../models/auditEvent.model.js';
import type { Principal } from '../../middleware/types.js';

export interface AuditContext {
  principal?: Principal | undefined;
  ip?: string | undefined;
  requestId?: string | undefined;
}

export interface AuditInput {
  event: string;
  entityType: EntityType;
  entityId: Types.ObjectId | string;
  entityLabel?: string;
  tenantId: Types.ObjectId | string;
  companyId?: Types.ObjectId | string | undefined;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
}

/** Builds an audit context from an Express request. */
export function auditContext(req: Request): AuditContext {
  return {
    principal: req.principal,
    ip: req.ip,
    requestId: req.requestId,
  };
}

/**
 * Append one audit record (PRD §29).
 *
 * Called from services rather than from middleware, so that `oldValue` and
 * `newValue` are the real before/after of a domain change rather than an HTTP
 * request body. Audit writes never fail a business operation — a lost audit
 * line is logged loudly but does not roll back an approved invoice.
 */
export async function record(input: AuditInput, context: AuditContext = {}): Promise<void> {
  try {
    await AuditEvent.create({
      tenantId: new Types.ObjectId(String(input.tenantId)),
      companyId: input.companyId ? new Types.ObjectId(String(input.companyId)) : undefined,
      event: input.event,
      entityType: input.entityType,
      entityId: new Types.ObjectId(String(input.entityId)),
      entityLabel: input.entityLabel,
      userId: context.principal?.userId,
      userName: context.principal?.name,
      timestamp: new Date(),
      oldValue: input.oldValue,
      newValue: input.newValue,
      metadata: input.metadata,
      ip: context.ip,
      requestId: context.requestId,
    });
  } catch (error) {
    logger.error(
      { err: error, event: input.event, entityId: String(input.entityId) },
      'failed to write audit event',
    );
  }
}

/** Convenience for the very common "status changed" record. */
export async function recordStatusChange(
  input: Omit<AuditInput, 'oldValue' | 'newValue'> & { from: string; to: string; reason?: string },
  context: AuditContext = {},
): Promise<void> {
  const { from, to, reason, ...rest } = input;
  await record(
    {
      ...rest,
      oldValue: { status: from },
      newValue: { status: to },
      metadata: { ...rest.metadata, ...(reason ? { reason } : {}) },
    },
    context,
  );
}

export const audit = { record, recordStatusChange, context: auditContext };
