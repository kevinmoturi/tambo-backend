import { Schema, model } from 'mongoose';
import type { Document } from 'mongoose';

export interface ITest extends Document {
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed';
  createdAt: Date;
}

const testSchema = new Schema<ITest>({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'running', 'completed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});

export default model<ITest>('Test', testSchema);
