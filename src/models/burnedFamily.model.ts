import { Schema, model } from 'mongoose';
import type { Document } from 'mongoose';

/**
 * Tombstone for a refresh-token family that was burned by reuse detection.
 *
 * Revoking a family with one updateMany is racy: a legitimate rotation in
 * flight can write its successor token AFTER the updateMany ran, and that
 * descendant would survive the burn. The tombstone closes the gap because it
 * is checked at USE time - any token of a burned family is rejected when
 * presented, regardless of when it was written.
 *
 * Rows expire with the refresh TTL: once every token that could name the
 * family has itself expired, the tombstone has nothing left to block.
 */
export interface IBurnedFamily extends Document {
  family: string;
  expiresAt: Date;
}

const burnedFamilySchema = new Schema<IBurnedFamily>({
  family: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export const BurnedFamily = model<IBurnedFamily>(
  'BurnedFamily',
  burnedFamilySchema,
);
export default BurnedFamily;
