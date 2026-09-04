/**
 * True for MongoDB's E11000 duplicate-key error. Relying on the unique index
 * (create-and-translate) instead of check-then-create removes the race where
 * two concurrent writes both pass a pre-check and the loser surfaces as a 500.
 */
export const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 11000;
