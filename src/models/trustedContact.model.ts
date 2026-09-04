import { Schema, model } from 'mongoose';
import type { Document, Types } from 'mongoose';

export const CONSENT_STATES = [
  'pending',
  'opted_in',
  'declined',
  'revoked',
] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/**
 * A third party the owner nominates to receive theft alerts. They have not
 * installed anything and never agreed to anything - which is why consent is a
 * real state machine and not a checkbox the owner ticks on their behalf
 * (Evidence doc S5.2, play-compliance).
 *
 * pending  -> nomination email sent, awaiting their accept/decline
 * opted_in -> receives alerts (email now; WhatsApp later requires this state)
 * declined -> never contacted again
 * revoked  -> previously opted in, later opted out
 *
 * The consent token is opaque and stored hashed (house token discipline);
 * accept/decline consume it atomically, so a link works exactly once.
 */
export interface ITrustedContact extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  name: string;
  email: string;
  /** Stored for the WhatsApp future; unused by v1 delivery. */
  phone?: string;
  consentState: ConsentState;
  consentTokenHash?: string;
  consentExpiresAt?: Date;
  consentRequestedAt?: Date;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const trustedContactSchema = new Schema<ITrustedContact>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    consentState: { type: String, enum: CONSENT_STATES, default: 'pending' },
    consentTokenHash: {
      type: String,
      select: false,
      index: { unique: true, sparse: true },
    },
    consentExpiresAt: { type: Date },
    consentRequestedAt: { type: Date },
    respondedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.consentTokenHash;
        return ret;
      },
    },
  },
);

// one row per (owner, contact email) - re-nominating updates, never duplicates
trustedContactSchema.index({ user: 1, email: 1 }, { unique: true });

export const TrustedContact = model<ITrustedContact>(
  'TrustedContact',
  trustedContactSchema,
);
export default TrustedContact;
