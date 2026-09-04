import type { Request, RequestHandler } from 'express';
import config from '../config/config';
import { rateLimits } from '../config/rateLimits';
import RateLimit from '../models/rateLimit.model';
import { AppError } from '../utils/appError';
import { sha256Hex } from '../utils/tokens';

interface RateLimitOptions {
  /**
   * Names both the counter namespace and the rule in `config/rateLimits`.
   * Typed against the literal keys, so a missing rule is a compile error. The
   * rule is looked up per request, not captured at startup, so budgets stay
   * tunable at runtime (tests tighten them).
   */
  name: keyof typeof rateLimits;
  /**
   * What is being limited. Returning the email as well as the IP means one
   * attacker cannot lock out a victim's account from many addresses, and one
   * address cannot spray many accounts.
   */
  subject?: (req: Request) => string;
}

const clientIp = (req: Request): string =>
  req.ip ?? req.socket.remoteAddress ?? 'unknown';

/** Emails are hashed so the counter collection is not a harvestable address list. */
const hashSubject = (value: string): string => sha256Hex(value).slice(0, 32);

export const rateLimit = (options: RateLimitOptions): RequestHandler => {
  const handler: RequestHandler = (req, _res, next) => {
    if (!config.rateLimit.enabled) {
      next();
      return;
    }

    const rule = rateLimits[options.name];
    const subject = options.subject ? options.subject(req) : '';
    const key = `${options.name}:${hashSubject(`${clientIp(req)}|${subject}`)}`;

    const bump = () =>
      RateLimit.findOneAndUpdate(
        { key },
        {
          $inc: { hits: 1 },
          // only set on insert, so the window is anchored to the FIRST hit and a
          // burst of requests cannot keep sliding the expiry forward
          $setOnInsert: {
            expiresAt: new Date(Date.now() + rule.windowSeconds * 1000),
          },
        },
        { upsert: true, new: true },
      );

    const consume = async (): Promise<void> => {
      let counter = await bump();

      // Mongo's TTL monitor sweeps only every ~60s, so a row whose window has
      // elapsed can linger and keep rejecting. Treat it as gone: delete it
      // (guarded by its own expiresAt so a concurrent fresh row survives) and
      // start a new window.
      if (counter.expiresAt.getTime() <= Date.now()) {
        await RateLimit.deleteOne({ key, expiresAt: counter.expiresAt });
        counter = await bump();
      }

      if (counter.hits > rule.limit) {
        const retryAfter = Math.max(
          1,
          Math.ceil((counter.expiresAt.getTime() - Date.now()) / 1000),
        );
        throw AppError.tooManyRequests(
          'Too many requests. Please try again later.',
          retryAfter,
        );
      }
    };

    consume()
      .then(() => next())
      .catch(next);
  };

  return handler;
};

/** Reads a field from an already-validated body for use as a limiter subject. */
export const bodyField =
  (field: string) =>
  (req: Request): string => {
    const body = req.body as Record<string, unknown> | undefined;
    const value = body?.[field];
    return typeof value === 'string' ? value : '';
  };
