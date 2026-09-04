import request from 'supertest';
import app from '../src/app';
import PasswordResetToken from '../src/models/passwordResetToken.model';
import { noopMailer } from '../src/services/mailer/noop.mailer';
import { clearTestDb, closeTestDb, connectTestDb } from './helpers/db';
import { CREDENTIALS, EMAIL, login, registerUser } from './helpers/factories';

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

describe('POST /api/auth/change-password', () => {
  it('changes the password and evicts every existing session', async () => {
    const { accessToken, refreshToken } = await registerUser();
    const otherSession = await login();

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: CREDENTIALS.password,
        newPassword: NEW_PASSWORD,
      });

    expect(res.status).toBe(200);
    expect(typeof res.body.tokens.refreshToken).toBe('string');

    // both the caller's old session and the other device are gone
    for (const dead of [refreshToken, otherSession.body.tokens.refreshToken]) {
      expect(
        (
          await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: dead })
        ).status,
      ).toBe(401);
    }

    // the pair returned by the change still works
    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: res.body.tokens.refreshToken });
    expect(refreshed.status).toBe(200);
  });

  it('accepts the new password and rejects the old one afterwards', async () => {
    const { accessToken } = await registerUser();
    await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: CREDENTIALS.password,
        newPassword: NEW_PASSWORD,
      });

    expect((await login(EMAIL, NEW_PASSWORD)).status).toBe(200);
    expect((await login(EMAIL, CREDENTIALS.password)).status).toBe(401);
  });

  it('rejects a wrong current password without changing anything', async () => {
    const { accessToken } = await registerUser();

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'not-my-password', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_credentials');
    expect((await login()).status).toBe(200);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/auth/change-password').send({
      currentPassword: CREDENTIALS.password,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('sends a reset mail for a known address', async () => {
    await registerUser();
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: EMAIL });

    expect(res.status).toBe(204);
    expect(noopMailer.sent).toHaveLength(1);
    expect(noopMailer.sent[0]?.to).toBe(EMAIL);
  });

  it('is indistinguishable for an unknown address', async () => {
    const known = await registerUser();
    expect(known).toBeDefined();

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
    expect((await login(EMAIL, NEW_PASSWORD)).status).toBe(200);
    expect((await login(EMAIL, CREDENTIALS.password)).status).toBe(401);
    expect(
      (await request(app).post('/api/auth/refresh').send({ refreshToken }))
        .status,
    ).toBe(401);
  });

  it('is single use', async () => {
    await registerUser();
    const token = await requestReset();

    expect(
      (
        await request(app)
          .post('/api/auth/reset-password')
          .send({ token, password: NEW_PASSWORD })
      ).status,
    ).toBe(200);

    const replay = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'yet-another-password' });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('invalid_reset_token');
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

  it('is single use even under concurrent presentation', async () => {
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

  it('rejects a forged token', async () => {
    await registerUser();
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a'.repeat(96), password: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });
});
