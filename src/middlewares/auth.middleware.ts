import type { Request, RequestHandler } from 'express';
import { AppError } from '../utils/appError';
import { verifyAccessToken } from '../utils/tokens';
import type { UserRole } from '../models/user.model';

/** Rejects the request unless it carries a valid `Authorization: Bearer` access token. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    next(AppError.unauthorized('Missing bearer token.', 'missing_token'));
    return;
  }

  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length).trim());
    req.auth = { userId: payload.sub, role: payload.role };
    next();
  } catch (error) {
    next(error);
  }
};

/** Must be mounted after requireAuth. */
export const requireRole =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) {
      next(AppError.unauthorized());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(AppError.forbidden());
      return;
    }
    next();
  };

/** Narrows `req.auth` for handlers mounted behind requireAuth. */
export const authContext = (
  req: Request,
): { userId: string; role: UserRole } => {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
};
