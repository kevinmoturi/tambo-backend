import { Schema, model } from 'mongoose';
import type { Document } from 'mongoose';

/**
 * One counter per (rule, subject, window). Kept in Mongo rather than memory so
 * the limit is correct when more than one instance is running behind a load
 * balancer - an in-memory counter would let N instances allow N times the
 * intended budget.
 *
 * The TTL index on `expiresAt` both prunes the collection and defines the
 * window: when the row disappears, the budget has reset.
 */
export interface IRateLimit extends Document {
  key: string;
  hits: number;
  expiresAt: Date;
}

const rateLimitSchema = new Schema<IRateLimit>({
  key: { type: String, required: true, unique: true },
  hits: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export const RateLimit = model<IRateLimit>('RateLimit', rateLimitSchema);
export default RateLimit;
