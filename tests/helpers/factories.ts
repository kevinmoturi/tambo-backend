import request from 'supertest';
import { testServer } from '../setup/testServer';
import { noopMailer } from '../../src/services/mailer/noop.mailer';
import { retryPhantom } from './http';

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
  request(testServer())
    .post('/api/auth/otp/verify')
    .send({ challengeId, code });

/** Registration step 1 only: returns the raw challenge response. */
export const startRegister = (overrides: Partial<typeof CREDENTIALS> = {}) =>
  request(testServer())
    .post('/api/auth/register')
    .send({ ...CREDENTIALS, ...overrides });

/** Login step 1 only: returns the raw challenge response. */
export const startLogin = (
  email = CREDENTIALS.email,
  password = CREDENTIALS.password,
) => request(testServer()).post('/api/auth/login').send({ email, password });

/** Full signup: register, then complete the emailed OTP. Returns a live session. */
export const registerUser = async (
  overrides: Partial<typeof CREDENTIALS> = {},
): Promise<Registered> => {
  const res = await retryPhantom(() => startRegister(overrides), 'register');
  if (res.status !== 201) {
    throw new Error(
      `registerUser failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  const verified = await retryPhantom(
    () => verifyOtp(res.body.challenge.challengeId, latestOtpCode()),
    'register-otp-verify',
  );
  if (verified.status !== 200) {
    throw new Error(
      `registerUser OTP failed: ${verified.status} body=${JSON.stringify(verified.body)} ` +
        `text=${JSON.stringify(verified.text?.slice(0, 300))} ` +
        `content-type=${verified.headers['content-type'] ?? 'none'}`,
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
  const res = await retryPhantom(() => startLogin(email, password), 'login');
  if (res.status !== 200) {
    throw new Error(
      `loginUser failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  const verified = await retryPhantom(
    () => verifyOtp(res.body.challenge.challengeId, latestOtpCode()),
    'login-otp-verify',
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
