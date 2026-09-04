import request from 'supertest';
import app from '../src/app';
import { clearTestDb, closeTestDb, connectTestDb } from './helpers/db';
import { CREDENTIALS, EMAIL, login, registerUser } from './helpers/factories';

beforeAll(connectTestDb, 120_000);
afterEach(clearTestDb);
afterAll(closeTestDb);

describe('POST /api/auth/register', () => {
  it('creates a user and returns a usable token pair', async () => {
    const res = await request(app).post('/api/auth/register').send(CREDENTIALS);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      name: 'Ada Lovelace',
      email: EMAIL,
      role: 'user',
    });
    expect(typeof res.body.tokens.accessToken).toBe('string');
    expect(typeof res.body.tokens.refreshToken).toBe('string');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('never exposes the password hash', async () => {
    const res = await request(app).post('/api/auth/register').send(CREDENTIALS);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
  });

  it('treats email as case-insensitive for uniqueness', async () => {
    await registerUser();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...CREDENTIALS, email: 'ADA@TAMBO.APP' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('email_taken');
  });

  it('resolves a concurrent duplicate registration as one 201 and one 409', async () => {
    const fire = () =>
      request(app).post('/api/auth/register').send(CREDENTIALS);
    const results = await Promise.all([fire(), fire()]);
    const statuses = results.map((r) => r.status).sort();

    // previously the loser of this race surfaced as a 500
    expect(statuses).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe(
      'email_taken',
    );
  });

  it('ignores a client-supplied role instead of trusting it', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...CREDENTIALS, role: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
  });
});

describe('POST /api/auth/login', () => {
  it('returns tokens for valid credentials, ignoring email casing', async () => {
    await registerUser();
    const res = await login('ADA@tambo.app');

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
    expect(typeof res.body.tokens.accessToken).toBe('string');
  });

  it('gives an identical error for a wrong password and an unknown email', async () => {
    await registerUser();

    const wrongPassword = await login(CREDENTIALS.email, 'nope-nope-nope');
    const unknownEmail = await login('nobody@tambo.app', CREDENTIALS.password);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.code).toBe('invalid_credentials');
  });

  it('issues an independent session per login', async () => {
    const first = await registerUser();
    const second = await login();

    expect(second.body.tokens.refreshToken).not.toBe(first.refreshToken);

    // revoking one must not touch the other
    await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: first.refreshToken });

    const stillValid = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: second.body.tokens.refreshToken });
    expect(stillValid.status).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the caller', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
  });

  it.each([
    ['no header', undefined, 'missing_token'],
    ['wrong scheme', 'Token abc', 'missing_token'],
    ['garbage token', 'Bearer not-a-jwt', 'invalid_token'],
  ])('rejects %s', async (_label, header, code) => {
    const req = request(app).get('/api/auth/me');
    if (header) req.set('Authorization', header);
    const res = await req;

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(code);
  });
});
