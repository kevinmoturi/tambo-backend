import request from 'supertest';
import app from '../../src/app';
import { noopMailer } from '../../src/services/mailer/noop.mailer';

export const CREDENTIALS = {
  name: 'Ada Lovelace',
  email: 'Ada@Tambo.app',
  password: 'correct-horse-battery',
};

/** Normalized form the API stores and returns. */
export const EMAIL = CREDENTIALS.email.toLowerCase();

export interface Registered {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

/** Pulls the 6-digit code out of the most recent mail the noop driver captured. */
export const latestOtpCode = (): string => {
  const mail = noopMailer.sent.at(-1);
  if (!mail) throw new Error('no OTP mail captured');
  const match = /code is: (\d{6})/.exec(mail.text);
  if (!match?.[1]) throw new Error(`no code in mail body: ${mail.text}`);
  return match[1];
};

export const verifyOtp = (challengeId: string, code: string) =>
  request(app).post('/api/auth/otp/verify').send({ challengeId, code });

/** Registration step 1 only: returns the raw challenge response. */
export const startRegister = (overrides: Partial<typeof CREDENTIALS> = {}) =>
  request(app)
    .post('/api/auth/register')
    .send({ ...CREDENTIALS, ...overrides });

/** Login step 1 only: returns the raw challenge response. */
export const startLogin = (
  email = CREDENTIALS.email,
  password = CREDENTIALS.password,
) => request(app).post('/api/auth/login').send({ email, password });

/** Full signup: register, then complete the emailed OTP. Returns a live session. */
export const registerUser = async (
  overrides: Partial<typeof CREDENTIALS> = {},
): Promise<Registered> => {
  const res = await startRegister(overrides);
  if (res.status !== 201) {
    throw new Error(
      `registerUser failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  const verified = await verifyOtp(
    res.body.challenge.challengeId,
    latestOtpCode(),
  );
  if (verified.status !== 200) {
    throw new Error(
      `registerUser OTP failed: ${verified.status} ${JSON.stringify(verified.body)}`,
    );
  }

  return {
    accessToken: verified.body.tokens.accessToken,
    refreshToken: verified.body.tokens.refreshToken,
    userId: verified.body.user._id,
  };
};

/** Full login: password step, then complete the emailed OTP. Returns a live session. */
export const loginUser = async (
  email = CREDENTIALS.email,
  password = CREDENTIALS.password,
): Promise<Registered> => {
  const res = await startLogin(email, password);
  if (res.status !== 200) {
    throw new Error(
      `loginUser failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  const verified = await verifyOtp(
    res.body.challenge.challengeId,
    latestOtpCode(),
  );
  if (verified.status !== 200) {
    throw new Error(
      `loginUser OTP failed: ${verified.status} ${JSON.stringify(verified.body)}`,
    );
  }

  return {
    accessToken: verified.body.tokens.accessToken,
    refreshToken: verified.body.tokens.refreshToken,
    userId: verified.body.user._id,
  };
};
