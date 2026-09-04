import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not catch rejected promises from async handlers, which would
 * hang the request. Wrap every async route handler in this so failures reach
 * the global error handler.
 */
export const asyncHandler =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
