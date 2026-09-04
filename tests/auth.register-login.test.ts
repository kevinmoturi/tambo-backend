import request from 'supertest';
import app from '../src/app';
import User from '../src/models/user.model';
import { clearTestDb, closeTestDb, connectTestDb } from './helpers/db';
import {
  CREDENTIALS,
  EMAIL,
  latestOtpCode,
  loginUser,
  registerUser,
  startLogin,
  startRegister,
  verifyOtp,
} from './helpers/factories';

beforeAll(connectTestDb, 120_000);
afterEach(clearTestDb);
afterAll(closeTestDb);

describe('POST /api/auth/register', () => {
  it('opens a signup challenge instead of issuing tokens directly', async () => {
    const res = await startRegister();

    expect(res.status).toBe(201);
    expect(res.body.challenge).toMatchObject({ purpose: 'signup' });
    expect(typeof res.body.challenge.challengeId).toBe('string');
    // no session until the mailbox is proven
    expect(res.body.tokens).toBeUndefined();
    expect(res.body.user).toBeUndefined();
  });

  it('verifying the emailed code issues tokens and marks the email verified', async () => {
    const res = await startRegister();
    const verified = await verifyOtp(
      res.body.challenge.challengeId,
      latestOtpCode(),
    );

    expect(verified.status).toBe(200);
    expect(verified.body.user).toMatchObject({
      name: 'Ada Lovelace',
      email: EMAIL,
      role: 'user',
    });
    expect(verified.body.user.emailVerifiedAt).toBeTruthy();
    expect(typeof verified.body.tokens.accessToken).toBe('string');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${verified.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('never exposes the password hash anywhere in the flow', async () => {
    const res = await startRegister();
    const verified = await verifyOtp(
      res.body.challenge.challengeId,
      latestOtpCode(),
    );

    for (const body of [res.body, verified.body]) {
      expect(JSON.stringify(body)).not.toContain('$2b$');
    }
    expect(verified.body.user.passwordHash).toBeUndefined();
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

    const verified = await verifyOtp(
      res.body.challenge.challengeId,
      latestOtpCode(),
    );
    expect(verified.body.user.role).toBe('user');
  });
});

describe('POST /api/auth/login', () => {
  it('opens a login challenge after the password checks out, ignoring email casing', async () => {
    await registerUser();
    const res = await startLogin('ADA@tambo.app');

    expect(res.status).toBe(200);
    expect(res.body.challenge.purpose).toBe('login');
    expect(res.body.tokens).toBeUndefined();
  });

  it('completing the login challenge issues a usable session', async () => {
    await registerUser();
    const { accessToken } = await loginUser();

    const me = await request(app)
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

    await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: first.refreshToken });

    const stillValid = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: second.refreshToken });
    expect(stillValid.status).toBe(200);
  });

  it('heals an unverified account: a login code proves the mailbox too', async () => {
    // register but never complete the signup OTP
    await startRegister();
    expect(
      (await User.findOne({ email: EMAIL }))?.emailVerifiedAt,
    ).toBeUndefined();

    await loginUser();
    expect(
      (await User.findOne({ email: EMAIL }))?.emailVerifiedAt,
    ).toBeTruthy();
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
