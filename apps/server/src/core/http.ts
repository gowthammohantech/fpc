import type { Response } from 'express';

/** Send a JSON body with the given status. */
export function ok<T>(res: Response, body: T, status = 200): Response {
  return res.status(status).json(body);
}

export function created<T>(res: Response, body: T): Response {
  return res.status(201).json(body);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}
