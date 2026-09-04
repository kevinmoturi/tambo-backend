import crypto from 'crypto';
import request from 'supertest';
import { testServer } from './setup/testServer';
import config from '../src/config/config';
import EvidenceEnvelope from '../src/models/evidenceEnvelope.model';
import TheftEpisode from '../src/models/theftEpisode.model';
import { sweepExpiredMedia } from '../src/services/evidence.service';
import { sha256Hex } from '../src/utils/tokens';
import { clearTestDb, closeTestDb, connectTestDb } from './helpers/db';
import { registerUser } from './helpers/factories';

beforeAll(connectTestDb, 120_000);
afterEach(clearTestDb);
afterAll(closeTestDb);

const DAY = 24 * 60 * 60 * 1000;

interface Enrolled {
  accessToken: string;
  deviceId: string;
  ingestToken: string;
}

const enrol = async (threshold = 3): Promise<Enrolled> => {
  const { accessToken } = await registerUser();
  const res = await request(testServer())
    .post('/api/v1/devices')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name: 'My Tecno',
      imeis: ['356938035643809'],
      make: 'Tecno',
      deviceModel: 'Spark 20',
      failedUnlockThreshold: threshold,
    });
  return {
    accessToken,
    deviceId: res.body.device._id,
    ingestToken: res.body.ingestToken,
  };
};

let seq = 0;
const envelope = (
  type = 'UNLOCK_FAILED',
  payloadObj: object = { attempt: 1 },
) => {
  const payload = JSON.stringify(payloadObj);
  seq += 1;
  return {
    id: `env-${Date.now()}-${seq}`,
    type,
    capturedAt: new Date().toISOString(),
    payload,
    sha256: sha256Hex(payload),
  };
};

const ingest = (token: string, envelopes: object[]) =>
  request(testServer())
    .post('/api/v1/evidence')
    .set('X-Device-Token', token)
    .send({ envelopes });

const markStolen = (accessToken: string, deviceId: string) =>
  request(testServer())
    .post(`/api/v1/devices/${deviceId}/mark-stolen`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({});

describe('POST /api/v1/evidence', () => {
  it('verifies the hash, stores the envelope, and ACKs it', async () => {
    const { ingestToken } = await enrol();
    const env = envelope('TRAIL_POINT', {
      lat: -1.2921,
      lng: 36.8219,
      accuracy: 12,
    });

    const res = await ingest(ingestToken, [env]);

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([{ id: env.id, status: 'acked' }]);

    const stored = await EvidenceEnvelope.findOne({ envelopeId: env.id });
    expect(stored?.payload).toBe(env.payload);
    expect(stored?.receivedAt).toBeTruthy();
    // routine retention: ~90 days
    const days = (stored!.expiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });

  it('requires a device token, and a USER token does not work', async () => {
    const { accessToken } = await enrol();
    expect(
      (
        await request(testServer())
          .post('/api/v1/evidence')
          .send({ envelopes: [envelope()] })
      ).status,
    ).toBe(401);

    const asUser = await request(testServer())
      .post('/api/v1/evidence')
      .set('X-Device-Token', accessToken)
      .send({ envelopes: [envelope()] });
    expect(asUser.status).toBe(401);
  });

  it('rejects a tampered payload but keeps the rest of the batch (partial ACK)', async () => {
    const { ingestToken } = await enrol();
    const good = envelope();
    const tampered = { ...envelope(), payload: '{"attempt":999}' }; // hash no longer matches

    const res = await ingest(ingestToken, [good, tampered]);

    expect({
      status: res.status,
      results: res.body.results ?? res.body,
    }).toMatchObject({
      status: 200,
    });
    expect(res.body.results).toEqual([
      { id: good.id, status: 'acked' },
      { id: tampered.id, status: 'rejected', reason: 'hash_mismatch' },
    ]);
    expect(await EvidenceEnvelope.countDocuments({})).toBe(1);
  });

  it('is idempotent: a retried envelope ACKs as duplicate and is stored once', async () => {
    const { ingestToken } = await enrol();
    const env = envelope();

    await ingest(ingestToken, [env]);
    const retry = await ingest(ingestToken, [env]);

    expect(retry.body.results).toEqual([{ id: env.id, status: 'duplicate' }]);
    expect(await EvidenceEnvelope.countDocuments({})).toBe(1);
  });

  it('rejects an envelope id already claimed by ANOTHER device', async () => {
    const first = await enrol();
    const env = envelope();
    await ingest(first.ingestToken, [env]);

    // a second user's device tries to reuse the id
    const { accessToken } = await registerUser({ email: 'zuri@tambo.app' });
    const other = await request(testServer())
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Other',
        imeis: ['356938035643810'],
        make: 'X',
        deviceModel: 'Y',
      });

    const res = await ingest(other.body.ingestToken, [env]);
    expect(res.body.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'id_conflict',
    });
  });

  it('validates the batch shape', async () => {
    const { ingestToken } = await enrol();

    expect((await ingest(ingestToken, [])).status).toBe(400);
    expect(
      (await ingest(ingestToken, [{ ...envelope(), sha256: 'nothex' }])).status,
    ).toBe(400);
    expect(
      (await ingest(ingestToken, [{ ...envelope(), type: 'SELFIE' }])).status,
    ).toBe(400);
  });
});

describe('episode attachment and the threshold trigger', () => {
  it('attaches envelopes to an already-open episode with 12-month retention', async () => {
    const { accessToken, deviceId, ingestToken } = await enrol();
    const { body } = await markStolen(accessToken, deviceId);

    const env = envelope('TRAIL_POINT', { lat: -1.3, lng: 36.9 });
    const res = await ingest(ingestToken, [env]);

    expect(res.body.episodeId).toBe(body.episode._id);
    expect(res.body.episodeOpened).toBeUndefined();

    const stored = await EvidenceEnvelope.findOne({ envelopeId: env.id });
    expect(stored?.episode?.toString()).toBe(body.episode._id);
    const days = (stored!.expiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(360);
  });

  it('crossing the failed-unlock threshold auto-opens an episode', async () => {
    const { ingestToken } = await enrol(3);

    const below = await ingest(ingestToken, [envelope(), envelope()]);
    expect(below.body.episodeId).toBeUndefined();
    expect(await TheftEpisode.countDocuments({})).toBe(0);

    const crossing = await ingest(ingestToken, [envelope()]);
    expect(crossing.body.episodeOpened).toBe(true);
    expect(typeof crossing.body.episodeId).toBe('string');

    const episode = await TheftEpisode.findOne({});
    expect(episode?.openedBy).toBe('device');
    expect(episode?.status).toBe('open');
  });

  it('back-attaches the evidence that led to the threshold and extends its retention', async () => {
    const { ingestToken } = await enrol(3);
    const early = envelope('TRAIL_POINT', { lat: -1.29, lng: 36.82 });
    await ingest(ingestToken, [early, envelope(), envelope()]);
    await ingest(ingestToken, [envelope()]); // crosses

    const stored = await EvidenceEnvelope.findOne({ envelopeId: early.id });
    expect(stored?.episode).toBeTruthy();
    const days = (stored!.expiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(360);
  });

  it('never opens a second episode while one is open', async () => {
    const { accessToken, deviceId, ingestToken } = await enrol(1);
    await markStolen(accessToken, deviceId);

    await ingest(ingestToken, [envelope(), envelope()]);
    expect(await TheftEpisode.countDocuments({})).toBe(1);
  });

  it('threshold counts by SERVER receipt time, so a lying device clock changes nothing', async () => {
    const { ingestToken } = await enrol(3);
    const backdated = () => ({
      ...envelope(),
      capturedAt: '2001-01-01T00:00:00.000Z',
    });

    const res = await ingest(ingestToken, [
      backdated(),
      backdated(),
      backdated(),
    ]);
    expect(res.body.episodeOpened).toBe(true);
  });
});

describe('media upload', () => {
  const photoBytes = (): Buffer => crypto.randomBytes(1024); // stands in for a JPEG

  const upload = (
    token: string,
    envelopeId: string,
    content: Buffer,
    hash?: string,
  ) =>
    request(testServer())
      .post(`/api/v1/evidence/${envelopeId}/media`)
      .set('X-Device-Token', token)
      .set('X-Content-Sha256', hash ?? sha256Hex(content))
      .set('Content-Type', 'image/jpeg')
      .send(content);

  const photoEnvelope = async (ingestToken: string) => {
    const env = envelope('PHOTO', { camera: 'front' });
    await ingest(ingestToken, [env]);
    return env;
  };

  it('stores hash-verified bytes in GridFS and records them on the envelope', async () => {
    const { ingestToken } = await enrol();
    const env = await photoEnvelope(ingestToken);
    const content = photoBytes();

    const res = await upload(ingestToken, env.id, content);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      envelopeId: env.id,
      bytes: 1024,
      stored: true,
    });

    const stored = await EvidenceEnvelope.findOne({ envelopeId: env.id });
    expect(stored?.mediaFileId).toBeTruthy();
    expect(stored?.mediaSha256).toBe(sha256Hex(content));
    expect(stored?.mediaContentType).toBe('image/jpeg');
  });

  it('is idempotent for the same bytes, a conflict for different ones', async () => {
    const { ingestToken } = await enrol();
    const env = await photoEnvelope(ingestToken);
    const content = photoBytes();

    await upload(ingestToken, env.id, content);
    const retry = await upload(ingestToken, env.id, content);
    expect(retry.status).toBe(200);
    expect(retry.body.stored).toBe(false);

    const different = await upload(ingestToken, env.id, photoBytes());
    expect(different.status).toBe(409);
    expect(different.body.code).toBe('media_conflict');
  });

  it('rejects a wrong hash, a non-PHOTO envelope, and a missing hash header', async () => {
    const { ingestToken } = await enrol();
    const photo = await photoEnvelope(ingestToken);
    const trail = envelope('TRAIL_POINT', { lat: 0, lng: 0 });
    await ingest(ingestToken, [trail]);
    const content = photoBytes();

    const badHash = await upload(
      ingestToken,
      photo.id,
      content,
      'a'.repeat(64),
    );
    expect(badHash.status).toBe(400);
    expect(badHash.body.code).toBe('hash_mismatch');

    const wrongType = await upload(ingestToken, trail.id, content);
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.code).toBe('not_photo_envelope');

    const noHash = await request(testServer())
      .post(`/api/v1/evidence/${photo.id}/media`)
      .set('X-Device-Token', ingestToken)
      .set('Content-Type', 'image/jpeg')
      .send(content);
    expect(noHash.status).toBe(400);
    expect(noHash.body.code).toBe('missing_content_hash');
  });

  it("404s for another device's envelope", async () => {
    const first = await enrol();
    const env = await photoEnvelope(first.ingestToken);

    const { accessToken } = await registerUser({ email: 'zuri@tambo.app' });
    const other = await request(testServer())
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Other',
        imeis: ['356938035643810'],
        make: 'X',
        deviceModel: 'Y',
      });

    const res = await upload(other.body.ingestToken, env.id, photoBytes());
    expect(res.status).toBe(404);
  });
});

describe('retention', () => {
  it('the media sweep removes expired files and spares live ones', async () => {
    const { ingestToken } = await enrol();
    const expired = envelope('PHOTO', { camera: 'front' });
    const live = envelope('PHOTO', { camera: 'back' });
    await ingest(ingestToken, [expired, live]);

    for (const env of [expired, live]) {
      const content = crypto.randomBytes(256);
      await request(testServer())
        .post(`/api/v1/evidence/${env.id}/media`)
        .set('X-Device-Token', ingestToken)
        .set('X-Content-Sha256', sha256Hex(content))
        .set('Content-Type', 'image/jpeg')
        .send(content);
    }

    // expire ONE file's retention window
    const expiredDoc = await EvidenceEnvelope.findOne({
      envelopeId: expired.id,
    });
    const mongoose = (await import('mongoose')).default;
    await mongoose.connection
      .db!.collection('evidence_media.files')
      .updateOne(
        { _id: expiredDoc!.mediaFileId! },
        { $set: { 'metadata.expiresAt': new Date(Date.now() - 1000) } },
      );

    expect(await sweepExpiredMedia()).toBe(1);

    const files = await mongoose.connection
      .db!.collection('evidence_media.files')
      .find({})
      .toArray();
    expect(files).toHaveLength(1);
    expect(files[0]?.metadata?.envelopeId).toBe(live.id);
  });

  it('the batch cap is enforced', async () => {
    const { ingestToken } = await enrol();
    const tooMany = Array.from({ length: config.evidence.maxBatch + 1 }, () =>
      envelope(),
    );
    expect((await ingest(ingestToken, tooMany)).status).toBe(400);
  });
});
