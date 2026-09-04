import { Schema, model } from 'mongoose';
import type { Document, Types } from 'mongoose';

export const DELIVERY_KINDS = ['first_alert', 'full_pack'] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

/**
 * One email dispatched about one episode to one recipient. Two jobs:
 *
 * - first_alert is once-per-recipient-per-episode, enforced by a partial
 *   unique index - the owner marking stolen AND the device threshold firing
 *   must not double-alert anyone.
 * - full_pack rows are an audit trail (packs may legitimately be re-sent as
 *   more evidence arrives), and the earliest first_alert row is the
 *   "first-alert time" the pack's incident summary reports.
 */
export interface IPackDelivery extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  episode: Types.ObjectId;
  kind: DeliveryKind;
  recipient: string;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const packDeliverySchema = new Schema<IPackDelivery>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    episode: {
      type: Schema.Types.ObjectId,
      ref: 'TheftEpisode',
      required: true,
    },
    kind: { type: String, enum: DELIVERY_KINDS, required: true },
    recipient: { type: String, required: true },
    sentAt: { type: Date, required: true },
  },
  { timestamps: true, toJSON: { versionKey: false } },
);

packDeliverySchema.index({ episode: 1, kind: 1, sentAt: 1 });

// exactly one first-alert per recipient per episode, enforced by the database
packDeliverySchema.index(
  { episode: 1, recipient: 1, kind: 1 },
  { unique: true, partialFilterExpression: { kind: 'first_alert' } },
);

export const PackDelivery = model<IPackDelivery>(
  'PackDelivery',
  packDeliverySchema,
);
export default PackDelivery;
