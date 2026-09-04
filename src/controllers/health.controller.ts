import type { Request, Response } from 'express';
import mongoose from 'mongoose';

const STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Liveness + readiness in one. Returns 503 when the database is not usable so
 * a load balancer stops routing traffic here rather than serving 500s.
 */
export const health = (_req: Request, res: Response): void => {
  const state = mongoose.connection.readyState;
  const database = STATES[state] ?? 'unknown';
  const healthy = state === 1;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    database,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};
