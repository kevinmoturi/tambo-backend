import request from 'supertest';
import app from '../src/app';
import PasswordResetToken from '../src/models/passwordResetToken.model';
import { noopMailer } from '../src/services/mailer/noop.mailer';
import { clearTestDb, closeTestDb, connectTestDb } from './helpers/db';
import {
  CREDENTIALS,
  EMAIL,
  latestOtpCode,
  loginUser,
  registerUser,
  startLogin,
  verifyOtp,
} from './helpers/factories';

beforeAll(connectTestDb, 120_000);
afterEach(async () => {
  await clearTestDb();
  noopMailer.clear();
});
afterAll(closeTestDb);

const NEW_PASSWORD = 'a-brand-new-passphrase';

/** Pulls the reset token out of the mail the noop driver captured. */
const tokenFromMail = (): string => {
  const mail = noopMailer.sent.at(-1);
  if (!mail) throw new Error('no mail was sent');
  const match = /token=([a-f\d]+)/i.exec(mail.text);
  if (!match?.[1]) throw new Error(`no token in mail body: ${mail.text}`);
  return match[1];
};

const requestChange = (
  accessToken: string,
  currentPassword = CREDENTIALS.password,
) =>
  request(app)
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ currentPassword, newPassword: NEW_PASSWORD });

describe('POST /api/auth/change-password (OTP-confirmed)', () => {
  it('opens a challenge; nothing changes until the code is verified', async () => {
    const { accessToken, refreshToken } = await registerUser();

    const res = await requestChange(accessToken);
    expect(res.status).toBe(200);
    expect(res.body.challenge.purpose).toBe('password_change');
    expect(res.body.tokens).toBeUndefined();

    // pending only: old password still logs in, old session still refreshes
    expect((await startLogin()).status).toBe(200);
    expect(
      (await request(app).post('/api/auth/refresh').send({ refreshToken }))
        .status,
    ).toBe(200);
  });

  it('verifying the code applies the change and evicts every existing session', async () => {
    const { accessToken, refreshToken } = await registerUser();
    const otherSession = await loginUser();

    const res = await requestChange(accessToken);
    const verified = await verifyOtp(
      res.body.challenge.challengeId,
      latestOtpCode(),
    );

    expect(verified.status).toBe(200);
    expect(typeof verified.body.tokens.refreshToken).toBe('string');

    // both pre-change sessions are dead
    for (const dead of [refreshToken, otherSession.refreshToken]) {
      expect(
        (
          await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: dead })
        ).status,
      ).toBe(401);
    }

    // the fresh pair works; new password logs in; old one does not
    expect(
      (
        await request(app).post('/api/auth/refresh').send({
          refreshToken: verified.body.tokens.refreshToken,
        })
      ).status,
    ).toBe(200);
    expect((await startLogin(EMAIL, NEW_PASSWORD)).status).toBe(200);
    expect((await startLogin(EMAIL, CREDENTIALS.password)).status).toBe(401);
  });

  it('rejects a wrong current password without opening a challenge', async () => {
    const { accessToken } = await registerUser();
    noopMailer.clear();

    const res = await requestChange(accessToken, 'not-my-password');
    // include the body in the failure output - this assertion once flaked
    // under full parallel load and the status alone did not say why
    expect({ status: res.status, body: res.body }).toEqual({
      status: 401,
      body: expect.objectContaining({ code: 'invalid_credentials' }),
    });
    expect(noopMailer.sent).toHaveLength(0);
    expect((await startLogin()).status).toBe(200);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/auth/change-password').send({
      currentPassword: CREDENTIALS.password,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(401);
  });

  it('invalidates outstanding reset links when the change is verified', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });
    const preChangeToken = tokenFromMail();

    const res = await requestChange(accessToken);
    await verifyOtp(res.body.challenge.challengeId, latestOtpCode());

    const hijack = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: preChangeToken, password: 'attacker-password' });

    expect(hijack.status).toBe(401);
    expect(hijack.body.code).toBe('invalid_reset_token');
    expect((await startLogin(EMAIL, NEW_PASSWORD)).status).toBe(200);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('sends a reset mail for a known address', async () => {
    await registerUser();
    noopMailer.clear();
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: EMAIL });

    expect(res.status).toBe(204);
    expect(noopMailer.sent).toHaveLength(1);
    expect(noopMailer.sent[0]?.to).toBe(EMAIL);
  });

  it('is indistinguishable for an unknown address', async () => {
    await registerUser();

    const hit = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: EMAIL });
    noopMailer.clear();
    const miss = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@tambo.app' });

    expect(miss.status).toBe(hit.status);
    expect(miss.body).toEqual(hit.body);
    expect(noopMailer.sent).toHaveLength(0); // nothing sent, but the client cannot tell
  });

  it('invalidates a previously issued token when a new one is requested', async () => {
    await registerUser();
    await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });
    const firstToken = tokenFromMail();

    await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });
    const secondToken = tokenFromMail();
    expect(secondToken).not.toBe(firstToken);

    const stale = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: firstToken, password: NEW_PASSWORD });
    expect(stale.status).toBe(401);

    const fresh = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: secondToken, password: NEW_PASSWORD });
    expect(fresh.status).toBe(200);
  });

  it('stores only a hash of the reset token', async () => {
    await registerUser();
    await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });
    const token = tokenFromMail();

    const stored = await PasswordResetToken.findOne({});
    expect(stored).not.toBeNull();
    expect(stored?.tokenHash).not.toBe(token);
    expect(stored?.tokenHash).toHaveLength(64);
  });
});

describe('POST /api/auth/reset-password', () => {
  const requestReset = async (): Promise<string> => {
    await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });
    return tokenFromMail();
  };

  it('sets the new password, returns a session, and kills the old ones', async () => {
    const { refreshToken } = await registerUser();
    const token = await requestReset();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect((await startLogin(EMAIL, NEW_PASSWORD)).status).toBe(200);
    expect((await startLogin(EMAIL, CREDENTIALS.password)).status).toBe(401);
    expect(
      (await request(app).post('/api/auth/refresh').send({ refreshToken }))
        .status,
    ).toBe(401);
  });

  it('is single use, even under concurrent presentation', async () => {
    await registerUser();
    const token = await requestReset();

    const results = await Promise.all([
      request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: NEW_PASSWORD }),
      request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'other-password' }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(1);
  });

  it('rejects an expired token', async () => {
    await registerUser();
    const token = await requestReset();
    await PasswordResetToken.updateMany(
      {},
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_reset_token');
  });

  it('rejects a forged token', async () => {
    await registerUser();
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a'.repeat(96), password: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });
});
