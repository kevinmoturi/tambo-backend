import { Schema, model } from 'mongoose';
import type { Document, Types } from 'mongoose';

/**
 * Same discipline as refresh tokens: the value mailed to the user is random and
 * opaque, and only its SHA-256 hash is stored. A database leak therefore does
 * not let an attacker reset anyone's password.
 *
 * Single-use is enforced by `usedAt`, and issuing a new token revokes any
 * outstanding ones for that user.
 */
export interface IPasswordResetToken extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const passwordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    // TTL index: expired rows are removed by mongo, no cleanup job needed
    expiresAt: { type: Date, required: true, expires: 0 },
    usedAt: { type: Date },
  },
  { timestamps: true },
);

export const PasswordResetToken = model<IPasswordResetToken>(
  'PasswordResetToken',
  passwordResetTokenSchema,
);
export default PasswordResetToken;
