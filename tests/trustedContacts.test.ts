import request from 'supertest';
import { testServer } from './setup/testServer';
import config from '../src/config/config';
import TrustedContact from '../src/models/trustedContact.model';
import { noopMailer } from '../src/services/mailer/noop.mailer';
import { clearTestDb, closeTestDb, connectTestDb } from './helpers/db';
import { EMAIL, registerUser } from './helpers/factories';

beforeAll(connectTestDb, 120_000);
afterEach(async () => {
  await clearTestDb();
  noopMailer.clear();
});
afterAll(closeTestDb);

const CONTACT = {
  name: 'Grace Hopper',
  email: 'grace@tambo.app',
  phone: '+254700000001',
};

const nominate = (accessToken: string, overrides: object = {}) =>
  request(testServer())
    .post('/api/v1/trusted-contacts')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ ...CONTACT, ...overrides });

/** Pulls the consent token out of the last nomination mail. */
const consentTokenFromMail = (): string => {
  const mail = noopMailer.sent.at(-1);
  if (!mail) throw new Error('no nomination mail captured');
  const match = /\/api\/v1\/consent\/([a-f\d]+)\/accept/i.exec(mail.text);
  if (!match?.[1]) throw new Error(`no consent link in mail: ${mail.text}`);
  return match[1];
};

const respond = (token: string, action: string) =>
  request(testServer()).get(`/api/v1/consent/${token}/${action}`);

describe('nomination', () => {
  it('creates the contact pending and emails THEM the choice', async () => {
    const { accessToken } = await registerUser();
    const res = await nominate(accessToken);

    expect(res.status).toBe(201);
    expect(res.body.contact).toMatchObject({
      name: 'Grace Hopper',
      email: 'grace@tambo.app',
      consentState: 'pending',
    });
    expect(res.body.contact.consentTokenHash).toBeUndefined();

    const mail = noopMailer.sent.at(-1);
    expect(mail?.to).toBe('grace@tambo.app');
    expect(mail?.text).toContain('/accept');
    expect(mail?.text).toContain('/decline');
    // the owner's name appears; the choice is framed as the contact's
    expect(mail?.text).toContain('Ada Lovelace');
  });

  it('enforces the per-user contact limit', async () => {
    const { accessToken } = await registerUser();
    for (let i = 0; i < config.trustedContacts.max; i += 1) {
      expect(
        (await nominate(accessToken, { email: `c${i}@tambo.app` })).status,
      ).toBe(201);
    }

    const res = await nominate(accessToken, {
      email: 'one-too-many@tambo.app',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('contact_limit_reached');
  });

  it('rejects self-nomination and duplicates', async () => {
    const { accessToken } = await registerUser();

    const self = await nominate(accessToken, { email: EMAIL });
    expect(self.status).toBe(400);
    expect(self.body.code).toBe('contact_is_self');

    await nominate(accessToken);
    const dupe = await nominate(accessToken, { name: 'Grace Again' });
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe('contact_exists');
  });

  it("lists and removes only the caller's contacts", async () => {
    const owner = await registerUser();
    const other = await registerUser({ email: 'zuri@tambo.app' });
    const { body } = await nominate(owner.accessToken);

    const otherList = await request(testServer())
      .get('/api/v1/trusted-contacts')
      .set('Authorization', `Bearer ${other.accessToken}`);
    expect(otherList.body.contacts).toHaveLength(0);

    const foreignDelete = await request(testServer())
      .delete(`/api/v1/trusted-contacts/${body.contact._id}`)
      .set('Authorization', `Bearer ${other.accessToken}`);
    expect(foreignDelete.status).toBe(404);

    const ownDelete = await request(testServer())
      .delete(`/api/v1/trusted-contacts/${body.contact._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ownDelete.status).toBe(204);
  });
});

describe('consent response (public)', () => {
  it('accept flips the contact to opted_in and burns the link', async () => {
    const { accessToken } = await registerUser();
    const { body } = await nominate(accessToken);
    const token = consentTokenFromMail();

    const res = await respond(token, 'accept');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Grace');

    const stored = await TrustedContact.findById(body.contact._id);
    expect(stored?.consentState).toBe('opted_in');
    expect(stored?.respondedAt).toBeTruthy();

    // single use: the same link cannot answer twice
    expect((await respond(token, 'decline')).status).toBe(401);
    expect(
      (await TrustedContact.findById(body.contact._id))?.consentState,
    ).toBe('opted_in');
  });

  it('decline flips to declined', async () => {
    const { accessToken } = await registerUser();
    const { body } = await nominate(accessToken);

    const res = await respond(consentTokenFromMail(), 'decline');
    expect(res.status).toBe(200);

    expect(
      (await TrustedContact.findById(body.contact._id))?.consentState,
    ).toBe('declined');
  });

  it('exactly one answer wins under a concurrent double-click', async () => {
    const { accessToken } = await registerUser();
    await nominate(accessToken);
    const token = consentTokenFromMail();

    const results = await Promise.all([
      respond(token, 'accept'),
      respond(token, 'decline'),
    ]);
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([200, 401]);
    expect(
      await TrustedContact.countDocuments({ consentState: 'pending' }),
    ).toBe(0);
  });

  it('rejects an expired link', async () => {
    const { accessToken } = await registerUser();
    await nominate(accessToken);
    const token = consentTokenFromMail();
    await TrustedContact.updateMany(
      {},
      { $set: { consentExpiresAt: new Date(Date.now() - 1000) } },
    );

    const res = await respond(token, 'accept');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_consent_token');
  });

  it('rejects a forged token and a bogus action', async () => {
    expect((await respond('a'.repeat(96), 'accept')).status).toBe(401);
    const { accessToken } = await registerUser();
    await nominate(accessToken);
    expect((await respond(consentTokenFromMail(), 'maybe')).status).toBe(400);
  });
});

describe('re-sending a nomination', () => {
  const resend = (accessToken: string, id: string) =>
    request(testServer())
      .post(`/api/v1/trusted-contacts/${id}/resend`)
      .set('Authorization', `Bearer ${accessToken}`);

  it('is cooldown-limited so a third party cannot be pestered', async () => {
    const { accessToken } = await registerUser();
    const { body } = await nominate(accessToken);

    const tooSoon = await resend(accessToken, body.contact._id);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.retryAfter).toBeGreaterThan(0);
  });

  it('rotates the token: the old link dies, the new one works', async () => {
    const original = config.trustedContacts.nominationCooldownSeconds;
    config.trustedContacts.nominationCooldownSeconds = 0;
    try {
      const { accessToken } = await registerUser();
      const { body } = await nominate(accessToken);
      const oldToken = consentTokenFromMail();

      expect((await resend(accessToken, body.contact._id)).status).toBe(204);
      const newToken = consentTokenFromMail();
      expect(newToken).not.toBe(oldToken);

      expect((await respond(oldToken, 'accept')).status).toBe(401);
      expect((await respond(newToken, 'accept')).status).toBe(200);
    } finally {
      config.trustedContacts.nominationCooldownSeconds = original;
    }
  });

  it('refuses once the contact has answered', async () => {
    const original = config.trustedContacts.nominationCooldownSeconds;
    config.trustedContacts.nominationCooldownSeconds = 0;
    try {
      const { accessToken } = await registerUser();
      const { body } = await nominate(accessToken);
      await respond(consentTokenFromMail(), 'accept');

      const res = await resend(accessToken, body.contact._id);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('contact_already_responded');
    } finally {
      config.trustedContacts.nominationCooldownSeconds = original;
    }
  });
});
