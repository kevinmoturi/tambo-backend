import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/appError';
import type { FieldError } from '../utils/appError';

interface Schemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Validates a request against zod schemas and REPLACES the request part with
 * the parsed result. Two consequences worth relying on downstream:
 *
 *  1. Unknown keys are stripped, so a client cannot smuggle extra fields into
 *     a service call (e.g. posting `role: "admin"` to /register).
 *  2. Coercions and transforms declared in the schema (trim, lowercase) have
 *     already been applied, so services receive normalized values.
 *
 * Handlers behind this middleware may treat `req.body` as the schema's type.
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    const details: FieldError[] = [];

    for (const key of ['body', 'params', 'query'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);

      if (result.success) {
        // `query` and `params` are getter-only in Express 5; assign defensively
        Object.defineProperty(req, key, {
          value: result.data,
          writable: true,
          configurable: true,
        });
      } else {
        for (const issue of result.error.issues) {
          details.push({
            field: [key === 'body' ? null : key, ...issue.path]
              .filter(Boolean)
              .join('.'),
            message: issue.message,
          });
        }
      }
    }

    if (details.length > 0) {
      next(AppError.validation(details));
      return;
    }
    next();
  };
