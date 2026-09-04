import express from 'express';
import request from 'supertest';
import app from '../src/app';
import User from '../src/models/user.model';
import { requireAuth, requireRole } from '../src/middlewares/auth.middleware';
import { errorHandler } from '../src/middlewares/errorHandler';
import { clearTestDb, closeTestDb, connectTestDb } from './helpers/db';
import { registerUser } from './helpers/factories';

/**
 * requireRole has no production route yet, so it is exercised against a
 * purpose-built app rather than left unproven until the first admin feature.
 */
const guardedApp = express();
guardedApp.get(
  '/admin-only',
  requireAuth,
  requireRole('admin'),
  (_req, res) => {
    res.json({ ok: true });
  },
);
guardedApp.get(
  '/any-role',
  requireAuth,
  requireRole('admin', 'user'),
  (_req, res) => {
    res.json({ ok: true });
  },
);
guardedApp.use(errorHandler);

beforeAll(connectTestDb, 120_000);
afterEach(clearTestDb);
afterAll(closeTestDb);

/** Promotes the user, then logs in again so the new role is inside the token. */
const adminToken = async (): Promise<string> => {
  const { userId } = await registerUser();
  await User.updateOne({ _id: userId }, { $set: { role: 'admin' } });

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'ada@tambo.app', password: 'correct-horse-battery' });
  return res.body.tokens.accessToken;
};

describe('requireRole', () => {
  it('allows a caller holding the required role', async () => {
    const token = await adminToken();
    const res = await request(guardedApp)
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('rejects a caller without it', async () => {
    const { accessToken } = await registerUser();
    const res = await request(guardedApp)
      .get('/admin-only')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('accepts any of several permitted roles', async () => {
    const { accessToken } = await registerUser();
    const res = await request(guardedApp)
      .get('/any-role')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
  });

  it('rejects an unauthenticated caller before checking the role', async () => {
    const res = await request(guardedApp).get('/admin-only');
    expect(res.status).toBe(401);
  });

  it('reflects the role at token-issue time, not the role in the database', async () => {
    // a demoted user keeps their elevated access until the access token expires;
    // this is the documented trade-off of stateless access tokens
    const token = await adminToken();
    await User.updateMany({}, { $set: { role: 'user' } });

    const res = await request(guardedApp)
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
