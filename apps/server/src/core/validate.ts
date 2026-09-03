import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ApiError } from './errors.js';

function format(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Parse and replace `req.body`, rejecting with a 422 and field-level detail. */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(ApiError.unprocessable('Request body is invalid', format(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Parse `req.query` into `req.validatedQuery` (Express 5 makes query readonly). */
export function validateQuery<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(ApiError.badRequest('Query parameters are invalid', format(result.error)));
      return;
    }
    req.validatedQuery = result.data;
    next();
  };
}

/** Typed accessor for the value stored by `validateQuery`. */
export function query<S extends ZodTypeAny>(req: Request, _schema?: S): z.infer<S> {
  return req.validatedQuery as z.infer<S>;
}
