import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not catch rejected promises from async handlers, so every
 * route is wrapped in this to route failures into the error middleware.
 */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(handler: (req: Req, res: Res, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as Req, res as Res, next)).catch(next);
  };
}
