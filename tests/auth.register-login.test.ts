import request from 'supertest';
import { testServer } from './setup/testServer';
import User from '../src/models/user.model';
import { clearTestDb, closeTestDb, connectTestDb } from './helpers/db';
import {
  CREDENTIALS,
  EMAIL,
  loginUser,
  registerUser,
  startLogin,
  startRegister,
} from './helpers/factories';

beforeAll(connectTestDb, 120_000);
afterEach(clearTestDb);
afterAll(closeTestDb);

describe('POST /api/auth/register', () => {
  it('returns the user and tokens immediately', async () => {
    const res = await startRegister();

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      name: 'Ada Lovelace',
      email: EMAIL,
      role: 'user',
    });
    expect(res.body.user.emailVerifiedAt).toBeTruthy();
    expect(typeof res.body.tokens.accessToken).toBe('string');
    expect(typeof res.body.tokens.refreshToken).toBe('string');
    expect(res.body.challenge).toBeUndefined();

    const me = await request(testServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('never exposes the password hash', async () => {
    const res = await startRegister();

    expect(JSON.stringify(res.body)).not.toContain('$2b$');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('treats email as case-insensitive for uniqueness', async () => {
    await registerUser();
    const res = await startRegister({ email: 'ADA@TAMBO.APP' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('email_taken');
  });

  it('resolves a concurrent duplicate registration as one 201 and one 409', async () => {
    const results = await Promise.all([startRegister(), startRegister()]);
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe(
      'email_taken',
    );
  });

  it('ignores a client-supplied role instead of trusting it', async () => {
    const res = await startRegister({ role: 'admin' } as Partial<
      typeof CREDENTIALS
    >);

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
  });
});

describe('POST /api/auth/login', () => {
  it('returns the user and tokens after the password checks out, ignoring email casing', async () => {
    await registerUser();
    const res = await startLogin('ADA@tambo.app');

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
    expect(typeof res.body.tokens.accessToken).toBe('string');
    expect(typeof res.body.tokens.refreshToken).toBe('string');
    expect(res.body.challenge).toBeUndefined();
  });

  it('issues a usable session directly', async () => {
    await registerUser();
    const { accessToken } = await loginUser();

    const me = await request(testServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(EMAIL);
  });

  it('gives an identical error for a wrong password and an unknown email', async () => {
    await registerUser();

    const wrongPassword = await startLogin(CREDENTIALS.email, 'nope-nope-nope');
    const unknownEmail = await startLogin(
      'nobody@tambo.app',
      CREDENTIALS.password,
    );

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.code).toBe('invalid_credentials');
  });

  it('issues an independent session per completed login', async () => {
    const first = await registerUser();
    const second = await loginUser();

    expect(second.refreshToken).not.toBe(first.refreshToken);

    await request(testServer())
      .post('/api/auth/logout')
      .send({ refreshToken: first.refreshToken });

    const stillValid = await request(testServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: second.refreshToken });
    expect(stillValid.status).toBe(200);
  });

  it('allows login without an email verification timestamp', async () => {
    await startRegister();
    await User.updateOne({ email: EMAIL }, { $unset: { emailVerifiedAt: 1 } });

    const res = await startLogin();

    expect(res.status).toBe(200);
    expect(typeof res.body.tokens.accessToken).toBe('string');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the caller', async () => {
    const { accessToken } = await registerUser();
    const res = await request(testServer())
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
    const req = request(testServer()).get('/api/auth/me');
    if (header) req.set('Authorization', header);
    const res = await req;

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(code);
  });
});
