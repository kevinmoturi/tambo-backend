/**
 * Abuse budgets, kept in one place so they are reviewable at a glance and so
 * tests can tighten them to a couple of hits instead of simulating hundreds.
 */
export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

// `satisfies` (not a Record annotation) keeps the literal key type, so
// rateLimit({ name }) is checked at compile time - a typo'd rule name is a
// tsc error, not a runtime throw.
export const rateLimits = {
  /** Brute-force protection. Keyed on email + IP. */
  login: { limit: 5, windowSeconds: 15 * 60 },
  /** Signup spam. Keyed on IP. */
  register: { limit: 10, windowSeconds: 60 * 60 },
  /** Reset-email spam / mailbox flooding. Keyed on email + IP. */
  forgotPassword: { limit: 3, windowSeconds: 60 * 60 },
  /** Reset-token guessing. Keyed on IP. */
  resetPassword: { limit: 10, windowSeconds: 60 * 60 },
  /** Generous: a legitimate app refreshes on a timer. Keyed on IP. */
  refresh: { limit: 60, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;
