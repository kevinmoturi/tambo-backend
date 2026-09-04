import mongoose from 'mongoose';
import type { Types } from 'mongoose';

/**
 * Media (intruder photos) storage seam. v1 is GridFS - zero new
 * infrastructure at launch volumes - behind an interface small enough that an
 * S3-compatible object store is a drop-in replacement when volume justifies it
 * (decision #2 in the features plan).
 *
 * Files carry `metadata.expiresAt` because Mongo's TTL monitor only deletes
 * ENVELOPE documents - it cannot cascade into GridFS. The retention sweep
 * (evidence.service) deletes expired files by that metadata; episode
 * attachment extends it in step with the envelope.
 */

export interface StoredMedia {
  fileId: Types.ObjectId;
  bytes: number;
}

interface MediaMetadata {
  envelopeId: string;
  device: string;
  expiresAt: Date;
}

const bucket = (): InstanceType<typeof mongoose.mongo.GridFSBucket> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Media storage used before the database connected.');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: 'evidence_media' });
};

export const saveMedia = (
  content: Buffer,
  contentType: string,
  metadata: MediaMetadata,
): Promise<StoredMedia> =>
  new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(metadata.envelopeId, {
      contentType,
      metadata: { ...metadata },
    });
    upload.on('error', reject);
    upload.on('finish', () =>
      resolve({ fileId: upload.id, bytes: content.length }),
    );
    upload.end(content);
  });

/** Streams a stored file (pack assembly, F-C). */
export const openMedia = (fileId: Types.ObjectId): NodeJS.ReadableStream =>
  bucket().openDownloadStream(fileId);

export const deleteMedia = async (fileId: Types.ObjectId): Promise<void> => {
  try {
    await bucket().delete(fileId);
  } catch (error) {
    // deleting an already-gone file is a no-op, not a failure
    if (!(error instanceof Error && /not found/i.test(error.message)))
      throw error;
  }
};

/** Extends a file's retention in step with its envelope. */
export const extendMediaExpiry = async (
  fileId: Types.ObjectId,
  expiresAt: Date,
): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) return;
  await db
    .collection('evidence_media.files')
    .updateOne({ _id: fileId }, { $set: { 'metadata.expiresAt': expiresAt } });
};

/**
 * The retention job for media: deletes every file whose window has passed.
 * Returns the number removed. Run on an interval in server.ts; called directly
 * by tests.
 */
export const sweepExpiredMedia = async (): Promise<number> => {
  const db = mongoose.connection.db;
  if (!db) return 0;

  const expired = await db
    .collection('evidence_media.files')
    .find({ 'metadata.expiresAt': { $lt: new Date() } })
    .project({ _id: 1 })
    .toArray();

  for (const file of expired) {
    await deleteMedia(file._id as Types.ObjectId);
  }
  return expired.length;
};
