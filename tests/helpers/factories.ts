import request from 'supertest';
import app from '../../src/app';

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

export const registerUser = async (
  overrides: Partial<typeof CREDENTIALS> = {},
): Promise<Registered> => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ ...CREDENTIALS, ...overrides });

  if (res.status !== 201) {
    throw new Error(
      `registerUser failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  return {
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
    userId: res.body.user._id,
  };
};

export const login = (
  email = CREDENTIALS.email,
  password = CREDENTIALS.password,
) => request(app).post('/api/auth/login').send({ email, password });
