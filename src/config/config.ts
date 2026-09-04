import dotenv from 'dotenv';

dotenv.config();

/**
 * Captured BEFORE defaulting: several security decisions below must
 * distinguish "explicitly development" from "nobody set NODE_ENV", because a
 * container that forgot to set it must fail safe, not fail open.
 */
const rawNodeEnv = process.env.NODE_ENV;
const isLocalEnv = rawNodeEnv === 'development' || rawNodeEnv === 'test';

const MAIL_DRIVERS = ['console', 'noop'] as const;
type MailDriver = (typeof MAIL_DRIVERS)[number];

interface Config {
  port: number;
  nodeEnv: string;
  /** True only when NODE_ENV is explicitly "development" - never by default. */
  isDevelopment: boolean;
  mongodbUri: string;
  bcryptRounds: number;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshTtlDays: number;
  };
  passwordReset: {
    ttlMinutes: number;
  };
  mail: {
    /** 'console' logs to stdout, 'noop' discards. Real providers slot in here. */
    driver: MailDriver;
    from: string;
    /** Deep-link base the mobile app handles, used to build reset links. */
    appUrl: string;
  };
  rateLimit: {
    /** Disable in tests that are not specifically exercising limits. */
    enabled: boolean;
  };
  cors: {
    /** Empty means "no browser origins allowed" - correct for a mobile-only API. */
    allowedOrigins: string[];
  };
  /**
   * Number of reverse proxies in front of the app. MUST be accurate: too high
   * and a client can spoof its IP via X-Forwarded-For, defeating rate limiting.
   * 0 means "no proxy, use the socket address".
   */
  trustProxy: number;
}

/**
 * Reads a variable the app cannot safely run without. The built-in fallback is
 * allowed ONLY when NODE_ENV is explicitly development or test - production,
 * staging, typos, and an unset NODE_ENV all refuse to boot, and even the
 * permitted fallback announces itself so it can never engage silently.
 */
const required = (key: string, devFallback: string): string => {
  const value = process.env[key];
  if (value) return value;

  if (!isLocalEnv) {
    throw new Error(
      `${key} must be set when NODE_ENV is "${rawNodeEnv ?? '(unset)'}". ` +
        'Only an explicit NODE_ENV of development or test may omit it.',
    );
  }

  console.warn(
    `[config] ${key} is not set - using an INSECURE built-in ${rawNodeEnv} fallback.`,
  );
  return devFallback;
};

/**
 * TRUST_PROXY feeds req.ip, which keys the rate limiter. Express accepts
 * booleans here, but "true" means "trust every proxy" - which lets any client
 * forge X-Forwarded-For - so only an explicit hop count is accepted, and
 * anything else (including the conventional "true") refuses to boot rather
 * than silently degrading to 0.
 */
const parseTrustProxy = (): number => {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === '') return 0;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `TRUST_PROXY must be the number of reverse proxies in front of the app (e.g. 1); got "${raw}".`,
    );
  }
  return Number(raw);
};

/** A typo'd driver must fail at boot, not silently print reset tokens to stdout. */
const parseMailDriver = (): MailDriver => {
  const raw = process.env.MAIL_DRIVER || 'console';
  if (!(MAIL_DRIVERS as readonly string[]).includes(raw)) {
    throw new Error(
      `MAIL_DRIVER must be one of: ${MAIL_DRIVERS.join(', ')}; got "${raw}".`,
    );
  }
  return raw as MailDriver;
};

const config: Config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: rawNodeEnv || 'development',
  isDevelopment: rawNodeEnv === 'development',
  mongodbUri: process.env.MONGODB_URI || '',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  jwt: {
    accessSecret: required(
      'JWT_ACCESS_SECRET',
      'dev-only-insecure-access-secret',
    ),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS) || 30,
  },
  passwordReset: {
    ttlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 60,
  },
  mail: {
    driver: parseMailDriver(),
    from: process.env.MAIL_FROM || 'Tambo <no-reply@tambo.local>',
    appUrl: process.env.APP_URL || 'tambo://',
  },
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
  },
  cors: {
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  trustProxy: parseTrustProxy(),
};

export default config;
