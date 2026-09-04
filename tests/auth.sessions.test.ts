import request from 'supertest';
import app from '../src/app';
import RefreshToken from '../src/models/refreshToken.model';
import { clearTestDb, closeTestDb, connectTestDb } from './helpers/db';
import { loginUser, registerUser } from './helpers/factories';

beforeAll(connectTestDb, 120_000);
afterEach(clearTestDb);
afterAll(closeTestDb);

const refreshWith = (refreshToken: string) =>
  request(app).post('/api/auth/refresh').send({ refreshToken });

describe('POST /api/auth/refresh', () => {
  it('rotates the token and the replacement works', async () => {
    const { refreshToken } = await registerUser();
    const res = await refreshWith(refreshToken);

    expect(res.status).toBe(200);
    expect(res.body.tokens.refreshToken).not.toBe(refreshToken);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('detects reuse and burns the entire token family', async () => {
    const { refreshToken } = await registerUser();
    const rotated = await refreshWith(refreshToken);

    const replay = await refreshWith(refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('refresh_token_reused');

    // the descendant issued by the legitimate rotation must die too
    const descendant = await refreshWith(rotated.body.tokens.refreshToken);
    expect(descendant.status).toBe(401);

    expect(
      await RefreshToken.countDocuments({ revokedAt: { $exists: false } }),
    ).toBe(0);
  });

  it('does not burn OTHER sessions when one family is compromised', async () => {
    const first = await registerUser();
    const second = await loginUser();

    await refreshWith(first.refreshToken);
    await refreshWith(first.refreshToken); // trigger reuse detection

    const other = await refreshWith(second.refreshToken);
    expect(other.status).toBe(200);
  });

  it('a concurrently replayed token burns the whole family, whatever the interleaving', async () => {
    const { refreshToken } = await registerUser();

    const results = await Promise.all([
      refreshWith(refreshToken),
      refreshWith(refreshToken),
    ]);
    const successes = results.filter((r) => r.status === 200);
    const failures = results.filter((r) => r.status === 401);

    // The invariant: a concurrent replay can NEVER yield two live sessions.
    // Depending on the interleaving either one presenter briefly wins (and its
    // token is already burned) or the tombstone catches both - but never two.
    expect(successes.length).toBeLessThanOrEqual(1);
    expect(failures.length).toBeGreaterThanOrEqual(1);

    // any token that WAS issued during the race must already be dead
    for (const winner of successes) {
      expect((await refreshWith(winner.body.tokens.refreshToken)).status).toBe(
        401,
      );
    }

    // and nothing survives at the store level either
    expect(
      await RefreshToken.countDocuments({ revokedAt: { $exists: false } }),
    ).toBe(0);
  });

  it('rejects an unknown token', async () => {
    const res = await refreshWith('deadbeef');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_refresh_token');
  });

  it('rejects an expired token', async () => {
    const { refreshToken } = await registerUser();
    await RefreshToken.updateMany(
      {},
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const res = await refreshWith(refreshToken);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_refresh_token');
  });
});

describe('logout', () => {
  it('revokes the presented token only', async () => {
    const { refreshToken } = await registerUser();

    const out = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken });
    expect(out.status).toBe(204);

    expect((await refreshWith(refreshToken)).status).toBe(401);
  });

  it('is idempotent for an unknown token', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: 'nonexistent' });
    expect(res.status).toBe(204);
  });

  it('logout-all revokes every session for the user', async () => {
    const { accessToken } = await registerUser();
    const second = await loginUser();

    const out = await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(out.status).toBe(204);

    expect((await refreshWith(second.refreshToken)).status).toBe(401);
  });
});

describe('session management', () => {
  it("lists live sessions and flags the caller's own", async () => {
    const first = await registerUser();
    await loginUser();

    const res = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .set('X-Refresh-Token', first.refreshToken);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(
      res.body.sessions.filter((s: { current: boolean }) => s.current),
    ).toHaveLength(1);
  });

  it('revokes a named session', async () => {
    const first = await registerUser();
    const second = await loginUser();

    const list = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .set('X-Refresh-Token', first.refreshToken);

    const other = list.body.sessions.find(
      (s: { current: boolean }) => !s.current,
    );

    const res = await request(app)
      .delete(`/api/auth/sessions/${other.id}`)
      .set('Authorization', `Bearer ${first.accessToken}`);
    expect(res.status).toBe(204);

    expect((await refreshWith(second.refreshToken)).status).toBe(401);
    expect((await refreshWith(first.refreshToken)).status).toBe(200);
  });

  it("refuses to revoke another user's session", async () => {
    const victim = await registerUser();
    const attacker = await registerUser({ email: 'mallory@tambo.app' });

    const list = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${victim.accessToken}`);

    const res = await request(app)
      .delete(`/api/auth/sessions/${list.body.sessions[0].id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect((await refreshWith(victim.refreshToken)).status).toBe(200);
  });
});
