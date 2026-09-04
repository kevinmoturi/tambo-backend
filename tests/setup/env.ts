/**
 * Runs before any module (including config.ts) is imported, so these win over
 * whatever is in .env - dotenv never overrides an already-set variable.
 *
 * Rate limiting is off by default so ordinary tests are not throttled; the
 * rate-limit suite re-enables it explicitly.
 */
process.env.NODE_ENV = 'test';
process.env.MAIL_DRIVER = 'noop';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.JWT_ACCESS_SECRET = 'test-secret-not-used-anywhere-real';
process.env.BCRYPT_ROUNDS = '4'; // keep the suite fast; production uses 12
