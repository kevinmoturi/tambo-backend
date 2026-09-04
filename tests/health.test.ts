import request from 'supertest';
import app from '../src/app';
import { closeTestDb, connectTestDb } from './helpers/db';

/**
 * Runs against the real connection lifecycle rather than a mock, so the order
 * matters: assert the disconnected state before connecting.
 */
describe('GET /api/health', () => {
  it('reports 503 while the database is not connected', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.database).toBe('disconnected');
  });

  it('reports 200 once connected', async () => {
    await connectTestDb();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
    expect(typeof res.body.uptime).toBe('number');

    await closeTestDb();
  }, 120_000);
});
