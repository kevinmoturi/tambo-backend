import { Schema, model } from 'mongoose';
import type { Document, Types } from 'mongoose';

export const DEVICE_STATUSES = ['active', 'stolen'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

/**
 * A phone enrolled for protection. IMEIs are OWNER-ENTERED: Android 10+ does
 * not let the app read them, so the source of truth is the human (see the
 * feasibility triage). They matter because the police report and the operator
 * IMEI-blacklist request are keyed on them.
 *
 * `ingestTokenHash` is the device's evidence-upload credential (issued at
 * enrolment, shown once, stored hashed). It is scoped to ingest only and is
 * deliberately not a user session: a stolen phone must keep uploading evidence
 * even after the owner revokes their sessions, and a leaked ingest token must
 * never grant account access.
 */
export interface IDevice extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  name: string;
  imeis: string[];
  make: string;
  /** Named deviceModel because `model` collides with mongoose Document.model(). */
  deviceModel: string;
  colour?: string;
  /** Free text: vendor, date, price, receipt no - whatever the owner has. */
  purchaseInfo?: string;
  status: DeviceStatus;
  ingestTokenHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const deviceSchema = new Schema<IDevice>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    imeis: { type: [String], required: true },
    make: { type: String, required: true, trim: true },
    deviceModel: { type: String, required: true, trim: true },
    colour: { type: String, trim: true },
    purchaseInfo: { type: String, trim: true },
    status: { type: String, enum: DEVICE_STATUSES, default: 'active' },
    // never selected by default; the ingest-auth middleware queries BY hash
    ingestTokenHash: {
      type: String,
      select: false,
      index: { unique: true, sparse: true },
    },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.ingestTokenHash;
        return ret;
      },
    },
  },
);

export const Device = model<IDevice>('Device', deviceSchema);
export default Device;
