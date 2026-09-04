import { Schema, model } from 'mongoose';
import type { Document, Types } from 'mongoose';

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface IUser extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  name: string;
  /** Present for email/password accounts. Phone-OTP accounts may have none. */
  email?: string;
  /** Reserved for the phone-OTP flow. Stored normalized to E.164. */
  phone?: string;
  /** Absent for credential-less accounts such as phone-OTP-only users. */
  passwordHash?: string;
  role: UserRole;
  emailVerifiedAt?: Date;
  phoneVerifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      // sparse so phone-only accounts do not all collide on a null email
      index: { unique: true, sparse: true },
    },
    phone: {
      type: String,
      trim: true,
      index: { unique: true, sparse: true },
    },
    // never selected by default; the auth service opts in explicitly
    passwordHash: { type: String, select: false },
    role: { type: String, enum: USER_ROLES, default: 'user' },
    emailVerifiedAt: { type: Date },
    phoneVerifiedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

export const User = model<IUser>('User', userSchema);
export default User;
