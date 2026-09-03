import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { IllegalTransitionError } from '@fpc/shared';
import { logger } from '../config/logger.js';
import { isProduction } from '../config/env.js';
import { ApiError } from '../core/errors.js';

/** Translates every failure into the standard `{ error: { code, message } }` body. */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId;

  if (error instanceof ApiError) {
    if (error.status >= 500) logger.error({ err: error, requestId }, error.message);
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details, requestId },
    });
    return;
  }

  // An illegal lifecycle move is a client error: the UI offered an action the
  // entity's current state does not allow.
  if (error instanceof IllegalTransitionError) {
    res.status(409).json({
      error: {
        code: 'ILLEGAL_TRANSITION',
        message: error.message,
        details: { from: error.from, to: error.to },
        requestId,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'UNPROCESSABLE',
        message: 'Validation failed',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
        requestId,
      },
    });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    res.status(422).json({
      error: {
        code: 'UNPROCESSABLE',
        message: 'Validation failed',
        details: Object.entries(error.errors).map(([path, err]) => ({
          path,
          message: err.message,
        })),
        requestId,
      },
    });
    return;
  }

  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: `Invalid value for ${error.path}`, requestId },
    });
    return;
  }

  if (isDuplicateKeyError(error)) {
    res.status(409).json({
      error: {
        code: 'DUPLICATE_KEY',
        message: 'A record with these values already exists',
        details: error.keyValue,
        requestId,
      },
    });
    return;
  }

  logger.error({ err: error, requestId, path: req.path }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'Something went wrong' : String((error as Error)?.message ?? error),
      requestId,
    },
  });
}

/** Mongo duplicate-key error, without importing the driver's types directly. */
function isDuplicateKeyError(
  error: unknown,
): error is { code: number; keyValue?: Record<string, unknown> } {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
      requestId: req.requestId,
    },
  });
}
