import { Schema, model } from 'mongoose';
import type { Document, Types } from 'mongoose';

export const BUDDY_STATES = [
  'pending',
  'active',
  'declined',
  'revoked',
] as const;
export type BuddyState = (typeof BUDDY_STATES)[number];

/**
 * A directed link from an owner (the protected account) to a buddy (the Tambo
 * user who receives their theft alerts). The buddy is part of the ecosystem by
 * design: consent is their own IN-APP action, not an emailed link to an
 * outsider - stronger consent, and it gives us their User id for in-app / push
 * / (later) WhatsApp delivery, not just an email address.
 *
 * pending  -> invited; awaiting the buddy's in-app accept
 * active   -> accepted; receives alerts
 * declined -> the buddy said no
 * revoked  -> the owner removed them, or the buddy left
 *
 * `buddy` is null until the invited email belongs to a Tambo account: nominate
 * an email that is not yet registered and the link waits, then auto-binds when
 * that person signs up (email ownership proven by the signup OTP). `inviteEmail`
 * is the nomination key and the auto-bind key; it never reveals whether the
 * address is already registered (create always yields 'pending').
 */
export interface IBuddy extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  owner: Types.ObjectId;
  buddy?: Types.ObjectId;
  inviteEmail: string;
  inviteName?: string;
  status: BuddyState;
  invitedAt: Date;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const buddySchema = new Schema<IBuddy>(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    buddy: { type: Schema.Types.ObjectId, ref: 'User' },
    inviteEmail: { type: String, required: true, trim: true, lowercase: true },
    inviteName: { type: String, trim: true },
    status: { type: String, enum: BUDDY_STATES, default: 'pending' },
    invitedAt: { type: Date, required: true },
    respondedAt: { type: Date },
  },
  { timestamps: true, toJSON: { versionKey: false } },
);

// one link per (owner, invited email) - re-inviting updates, never duplicates
buddySchema.index({ owner: 1, inviteEmail: 1 }, { unique: true });
// "invitations addressed to me" and auto-bind lookups
buddySchema.index({ buddy: 1, status: 1 });
buddySchema.index({ inviteEmail: 1, buddy: 1 });

export const Buddy = model<IBuddy>('Buddy', buddySchema);
export default Buddy;
