import { Schema, model } from 'mongoose';
import type { Document, Types } from 'mongoose';

export const OTP_PURPOSES = [
  'signup',
  'login',
  'password_change',
  'email_change',
] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/**
 * One pending OTP verification. The 6-digit code is emailed and only its
 * bcrypt hash is stored: 1e6 possible codes are trivially brute-forced offline
 * against a fast hash, so unlike the high-entropy opaque tokens (sha256), OTP
 * codes get a slow hash. Online guessing is bounded by `attempts`.
 *
 * The challenge carries the pending side effect of its purpose (a new email
 * address, a new password hash), so nothing changes until the code is proven.
 * Consumption is an atomic claim - the same discipline as refresh rotation.
 */
export interface IOtpChallenge extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt?: Date;
  lastSentAt: Date;
  /** email_change: the address being claimed (the code is sent THERE). */
  pendingEmail?: string;
  /** password_change: bcrypt hash of the new password, applied on verify. */
  pendingPasswordHash?: string;
  /** Bound at creation so the eventual session records the requesting device. */
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const otpChallengeSchema = new Schema<IOtpChallenge>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    purpose: { type: String, enum: OTP_PURPOSES, required: true },
    codeHash: { type: String, required: true },
    // TTL index: expired challenges vanish on their own
    expiresAt: { type: Date, required: true, expires: 0 },
    attempts: { type: Number, required: true, default: 0 },
    consumedAt: { type: Date },
    lastSentAt: { type: Date, required: true },
    pendingEmail: { type: String },
    pendingPasswordHash: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true },
);

export const OtpChallenge = model<IOtpChallenge>(
  'OtpChallenge',
  otpChallengeSchema,
);
export default OtpChallenge;
