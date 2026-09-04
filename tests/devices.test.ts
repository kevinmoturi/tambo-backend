import express from 'express';
import request from 'supertest';
import app from '../src/app';
import Device from '../src/models/device.model';
import {
  deviceContext,
  requireDeviceToken,
} from '../src/middlewares/deviceAuth.middleware';
import { errorHandler } from '../src/middlewares/errorHandler';
import { clearTestDb, closeTestDb, connectTestDb } from './helpers/db';
import { registerUser } from './helpers/factories';

beforeAll(connectTestDb, 120_000);
afterEach(clearTestDb);
afterAll(closeTestDb);

const DEVICE = {
  name: 'My Tecno',
  imeis: ['356938035643809'],
  make: 'Tecno',
  deviceModel: 'Spark 20',
  colour: 'black',
};

const enrol = async (accessToken: string, overrides: object = {}) =>
  request(app)
    .post('/api/v1/devices')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ ...DEVICE, ...overrides });

describe('POST /api/v1/devices', () => {
  it('enrols a device and returns the ingest token exactly once', async () => {
    const { accessToken } = await registerUser();
    const res = await enrol(accessToken);

    expect(res.status).toBe(201);
    expect(res.body.device).toMatchObject({
      name: 'My Tecno',
      make: 'Tecno',
      deviceModel: 'Spark 20',
      status: 'active',
    });
    expect(typeof res.body.ingestToken).toBe('string');
    // the token never appears again: not on the device object, not on any read
    expect(res.body.device.ingestTokenHash).toBeUndefined();

    const readBack = await request(app)
      .get(`/api/v1/devices/${res.body.device._id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(JSON.stringify(readBack.body)).not.toContain(res.body.ingestToken);
    expect(readBack.body.device.ingestTokenHash).toBeUndefined();
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/devices').send(DEVICE);
    expect(res.status).toBe(401);
  });

  it.each([
    ['missing IMEI', { imeis: [] }],
    ['malformed IMEI', { imeis: ['12AB'] }],
    ['missing make', { make: '' }],
  ])('rejects %s', async (_label, overrides) => {
    const { accessToken } = await registerUser();
    const res = await enrol(accessToken, overrides);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });
});

describe('device management', () => {
  it("lists only the caller's devices", async () => {
    const owner = await registerUser();
    const other = await registerUser({ email: 'grace@tambo.app' });
    await enrol(owner.accessToken);
    await enrol(other.accessToken, { name: 'Grace phone' });

    const res = await request(app)
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0].name).toBe('My Tecno');
  });

  it("refuses to read another user's device, indistinguishably from a missing one", async () => {
    const owner = await registerUser();
    const attacker = await registerUser({ email: 'mallory@tambo.app' });
    const { body } = await enrol(owner.accessToken);

    const res = await request(app)
      .get(`/api/v1/devices/${body.device._id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('device_not_found');
  });

  it('updates fields', async () => {
    const { accessToken } = await registerUser();
    const { body } = await enrol(accessToken);

    const res = await request(app)
      .patch(`/api/v1/devices/${body.device._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ colour: 'blue', purchaseInfo: 'Safaricom shop, KES 14,000' });

    expect(res.status).toBe(200);
    expect(res.body.device.colour).toBe('blue');
  });

  it('rejects an empty update', async () => {
    const { accessToken } = await registerUser();
    const { body } = await enrol(accessToken);

    const res = await request(app)
      .patch(`/api/v1/devices/${body.device._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('deletes a device, but never one with an open theft episode', async () => {
    const { accessToken } = await registerUser();
    const { body } = await enrol(accessToken);
    const id = body.device._id;

    await request(app)
      .post(`/api/v1/devices/${id}/mark-stolen`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    const blocked = await request(app)
      .delete(`/api/v1/devices/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('episode_open');

    await request(app)
      .post(`/api/v1/devices/${id}/mark-recovered`)
      .set('Authorization', `Bearer ${accessToken}`);

    const removed = await request(app)
      .delete(`/api/v1/devices/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(removed.status).toBe(204);
    expect(await Device.countDocuments({})).toBe(0);
  });
});

describe('ingest token lifecycle', () => {
  // a scratch app proving the middleware evidence ingest (F-B) will mount
  const guardedApp = express();
  guardedApp.get('/probe', requireDeviceToken, (req, res) => {
    res.json({ deviceId: deviceContext(req)._id.toString() });
  });
  guardedApp.use(errorHandler);

  const probe = (token?: string) => {
    const req = request(guardedApp).get('/probe');
    return token ? req.set('X-Device-Token', token) : req;
  };

  it('authenticates the device that owns the token', async () => {
    const { accessToken } = await registerUser();
    const { body } = await enrol(accessToken);

    const res = await probe(body.ingestToken);
    expect(res.status).toBe(200);
    expect(res.body.deviceId).toBe(body.device._id);
  });

  it('rejects a missing or garbage token', async () => {
    expect((await probe()).body.code).toBe('missing_device_token');
    expect((await probe('deadbeef')).body.code).toBe('invalid_device_token');
  });

  it('rotation kills the old token instantly', async () => {
    const { accessToken } = await registerUser();
    const { body } = await enrol(accessToken);

    const rotated = await request(app)
      .post(`/api/v1/devices/${body.device._id}/token`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(rotated.status).toBe(200);

    expect((await probe(body.ingestToken)).status).toBe(401);
    expect((await probe(rotated.body.ingestToken)).status).toBe(200);
  });

  it('revocation leaves the device unable to upload at all', async () => {
    const { accessToken } = await registerUser();
    const { body } = await enrol(accessToken);

    const revoked = await request(app)
      .delete(`/api/v1/devices/${body.device._id}/token`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(revoked.status).toBe(204);

    expect((await probe(body.ingestToken)).status).toBe(401);
  });

  it('an ingest token is NOT a user credential', async () => {
    const { accessToken } = await registerUser();
    const { body } = await enrol(accessToken);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.ingestToken}`);
    expect(res.status).toBe(401);
  });
});
