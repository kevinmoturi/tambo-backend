import bcrypt from 'bcryptjs';
import config from '../../config/config';
import PasswordResetToken from '../../models/passwordResetToken.model';
import User from '../../models/user.model';
import type { IUser } from '../../models/user.model';
import { AppError } from '../../utils/appError';
import { isDuplicateKeyError } from '../../utils/mongoErrors';
import { generateOpaqueToken, hashOpaqueToken } from '../../utils/tokens';
import { mailer } from '../mailer';
import * as sessionService from '../session.service';
import type { TokenPair } from '../session.service';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '../../validation/auth.schema';

/**
 * Email + password credentials. This module is the ONLY place that knows about
 * passwords; session issuance lives in session.service. A future
 * otp.credential.ts implements the same shape for phone login and reuses the
 * exact same session machinery.
 */

export interface AuthResult {
  user: IUser;
  tokens: TokenPair;
}

/**
 * A real bcrypt hash of a value nobody can supply. Comparing against it when
 * the account does not exist keeps login's response time roughly constant, so
 * timing cannot be used to discover which emails are registered.
 */
const DUMMY_HASH =
  '$2b$12$2g05wDqWWn9kMCABYg.ORujVXYdM3wD1LSeZgoimOCSWGBBUF.L9W';

const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, config.bcryptRounds);

/**
 * The single mechanism for setting a password. Every credential an attacker
 * might be holding dies with it: all refresh sessions are revoked AND every
 * outstanding password-reset token is invalidated - otherwise a reset link
 * issued before the change could take the account straight back.
 *
 * Any future flow that sets a password (admin reset, adding a password to an
 * OTP-only account) MUST go through this function, not hash-and-save directly.
 */
const setPassword = async (user: IUser, newPassword: string): Promise<void> => {
  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  await Promise.all([
    sessionService.revokeAllForUser(user._id.toString()),
    PasswordResetToken.updateMany(
      { user: user._id, usedAt: { $exists: false } },
      { $set: { usedAt: new Date() } },
    ),
  ]);
};

export const register = async (
  input: RegisterInput,
  userAgent?: string,
): Promise<AuthResult> => {
  // No exists() pre-check: the unique index is the authority, and translating
  // its violation avoids the race where two concurrent registrations both pass
  // a pre-check and the loser surfaces as a 500.
  let user: IUser;
  try {
    user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict(
        'An account with that email already exists.',
        'email_taken',
      );
    }
    throw error;
  }

  return { user, tokens: await sessionService.startSession(user, userAgent) };
};

export const login = async (
  input: LoginInput,
  userAgent?: string,
): Promise<AuthResult> => {
  const user = await User.findOne({ email: input.email }).select(
    '+passwordHash',
  );
  const matches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  // One error for both "no such account" and "wrong password" - revealing which
  // would turn the login endpoint into an account-existence oracle.
  if (!user || !matches) {
    throw AppError.unauthorized(
      'Invalid email or password.',
      'invalid_credentials',
    );
  }

  return { user, tokens: await sessionService.startSession(user, userAgent) };
};

/**
 * Changing a password revokes every existing session AND every outstanding
 * reset link, then hands back a fresh pair - so a user who changes their
 * password because they suspect compromise actually evicts the attacker.
 */
export const changePassword = async (
  userId: string,
  input: ChangePasswordInput,
  userAgent?: string,
): Promise<AuthResult> => {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw AppError.unauthorized();

  if (!user.passwordHash) {
    throw AppError.badRequest(
      'This account has no password set.',
      'no_password_credential',
    );
  }

  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw AppError.unauthorized(
      'Current password is incorrect.',
      'invalid_credentials',
    );
  }

  await setPassword(user, input.newPassword);
  return { user, tokens: await sessionService.startSession(user, userAgent) };
};

/**
 * Always resolves, whether or not the email exists - the endpoint must not
 * reveal who has an account. Any outstanding reset token is invalidated so only
 * the newest link works.
 */
export const requestPasswordReset = async (email: string): Promise<void> => {
  const user = await User.findOne({ email });
  if (!user) return;

  await PasswordResetToken.updateMany(
    { user: user._id, usedAt: { $exists: false } },
    { $set: { usedAt: new Date() } },
  );

  const token = generateOpaqueToken();
  await PasswordResetToken.create({
    user: user._id,
    tokenHash: hashOpaqueToken(token),
    expiresAt: new Date(
      Date.now() + config.passwordReset.ttlMinutes * 60 * 1000,
    ),
  });

  // Fire-and-forget, deliberately: awaiting a real mail provider here would
  // make response latency reveal whether the email exists (known address =
  // provider round trip, unknown = instant), re-opening the enumeration hole
  // the unconditional 204 exists to close - and a provider outage would take
  // this endpoint down with it.
  void mailer
    .send({
      to: email,
      subject: 'Reset your Tambo password',
      text: [
        `Hi ${user.name},`,
        '',
        'Use the link below to choose a new password. It expires in ' +
          `${config.passwordReset.ttlMinutes} minutes and can only be used once.`,
        '',
        `${config.mail.appUrl}reset-password?token=${token}`,
        '',
        'If you did not request this, you can safely ignore this email.',
      ].join('\n'),
    })
    .catch((error) => {
      console.error('Failed to send password reset email:', error);
    });
};

/** Consumes a reset token, sets the new password, and evicts all old sessions. */
export const resetPassword = async (
  input: ResetPasswordInput,
  userAgent?: string,
): Promise<AuthResult> => {
  // Atomic claim, same discipline as refresh rotation: only one concurrent
  // presenter of this token can flip usedAt, so the token is truly single-use.
  const claimed = await PasswordResetToken.findOneAndUpdate(
    {
      tokenHash: hashOpaqueToken(input.token),
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    },
    { $set: { usedAt: new Date() } },
  );

  if (!claimed) {
    throw AppError.unauthorized(
      'This password reset link is invalid or has expired.',
      'invalid_reset_token',
    );
  }

  const user = await User.findById(claimed.user).select('+passwordHash');
  if (!user) {
    throw AppError.unauthorized(
      'Account no longer exists.',
      'invalid_reset_token',
    );
  }

  await setPassword(user, input.password);
  return { user, tokens: await sessionService.startSession(user, userAgent) };
};
