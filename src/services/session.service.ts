import crypto from 'crypto';
import config from '../config/config';
import RefreshToken from '../models/refreshToken.model';
import User from '../models/user.model';
import type { IUser } from '../models/user.model';
import { AppError } from '../utils/appError';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
} from '../utils/tokens';

/**
 * Session mechanics, deliberately credential-agnostic. Nothing here knows or
 * cares HOW the user proved who they are - only that someone already did.
 * That is what lets phone-OTP login reuse all of this untouched.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  current: boolean;
}

const refreshExpiryDate = (): Date =>
  new Date(Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);

/**
 * Issues an access/refresh pair. `family` ties rotated tokens together: every
 * refresh descends from the same login, so a replayed token can invalidate the
 * entire lineage rather than just itself.
 */
export const issueTokens = async (
  user: IUser,
  family: string,
  userAgent?: string,
): Promise<TokenPair> => {
  const refreshToken = generateOpaqueToken();

  await RefreshToken.create({
    user: user._id,
    tokenHash: hashOpaqueToken(refreshToken),
    family,
    expiresAt: refreshExpiryDate(),
    ...(userAgent ? { userAgent } : {}),
  });

  return {
    accessToken: signAccessToken({ sub: user._id.toString(), role: user.role }),
    refreshToken,
    expiresIn: config.jwt.accessTtl,
  };
};

/** Starts a brand new session lineage. Called after any successful login. */
export const startSession = (
  user: IUser,
  userAgent?: string,
): Promise<TokenPair> => issueTokens(user, crypto.randomUUID(), userAgent);

/**
 * Rotates a refresh token.
 *
 * Rejected when unknown, expired, or already revoked. The already-revoked case
 * is special: a token can only be presented twice if it leaked, so the whole
 * family is burned and every descendant session dies with it.
 *
 * The rotation CLAIMS the token atomically - one findOneAndUpdate that flips
 * revokedAt only while it is still unset - rather than read-check-write. Under
 * concurrency exactly one presenter wins; every other simultaneous presenter
 * falls into the reuse branch. (A non-atomic version let two parallel
 * presentations both succeed, silently defeating reuse detection.)
 */
export const refresh = async (
  token: string,
  userAgent?: string,
): Promise<{ user: IUser; tokens: TokenPair }> => {
  const tokenHash = hashOpaqueToken(token);

  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );

  if (!claimed) {
    // Unclaimable: unknown, or already revoked - and "already revoked"
    // includes losing the claim race above, which is precisely a replay.
    const stored = await RefreshToken.findOne({ tokenHash });

    if (stored?.revokedAt) {
      await RefreshToken.updateMany(
        { family: stored.family, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date() } },
      );
      throw AppError.unauthorized(
        'Refresh token has already been used. Please sign in again.',
        'refresh_token_reused',
      );
    }

    throw AppError.unauthorized(
      'Invalid or expired refresh token.',
      'invalid_refresh_token',
    );
  }

  if (claimed.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized(
      'Invalid or expired refresh token.',
      'invalid_refresh_token',
    );
  }

  const user = await User.findById(claimed.user);
  if (!user) {
    throw AppError.unauthorized(
      'Account no longer exists.',
      'invalid_refresh_token',
    );
  }

  return { user, tokens: await issueTokens(user, claimed.family, userAgent) };
};

/** Revokes a single session. Idempotent: unknown or already-revoked tokens are a no-op. */
export const revokeByToken = async (token: string): Promise<void> => {
  await RefreshToken.updateOne(
    { tokenHash: hashOpaqueToken(token), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
};

/**
 * Revokes every live session for a user. Called on "sign out everywhere", and
 * automatically on password change or reset - a stolen session must not
 * survive the user reacting to the theft.
 */
export const revokeAllForUser = async (userId: string): Promise<void> => {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
};

/** Powers a "signed in on these devices" screen. */
export const listSessions = async (
  userId: string,
  currentToken?: string,
): Promise<SessionSummary[]> => {
  const currentHash = currentToken ? hashOpaqueToken(currentToken) : null;

  const sessions = await RefreshToken.find({
    user: userId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  return sessions.map((session) => ({
    id: session._id.toString(),
    userAgent: session.userAgent ?? null,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    current: currentHash !== null && session.tokenHash === currentHash,
  }));
};

/** Revokes one named session belonging to the caller. */
export const revokeSessionById = async (
  userId: string,
  sessionId: string,
): Promise<void> => {
  const result = await RefreshToken.updateOne(
    { _id: sessionId, user: userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );

  if (result.matchedCount === 0) {
    throw AppError.notFound('Session not found.', 'session_not_found');
  }
};
