import crypto from 'crypto';
import config from '../config/config';

/**
 * Ed25519 signing for the evidence pack's integrity manifest. The signature
 * makes the pack TAMPER-EVIDENT: a recipient holding the pack can verify that
 * nothing changed after Tambo generated it. It is a credible business record -
 * deliberately never claimed as forensic certification (Evidence doc S4.3).
 *
 * The 32-byte seed comes from config; keys are derived deterministically from
 * it via the standard PKCS8/SPKI DER framing, so signatures stay verifiable
 * across restarts and deploys as long as the seed is stable.
 */

// DER prefixes for raw Ed25519 key material (RFC 8410)
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const seed = Buffer.from(config.packSigningSeed, 'hex');

const privateKey = crypto.createPrivateKey({
  key: Buffer.concat([PKCS8_PREFIX, seed]),
  format: 'der',
  type: 'pkcs8',
});

// derive the public half by exporting from the private key
const publicKeyDer = crypto
  .createPublicKey(privateKey)
  .export({ format: 'der', type: 'spki' });

/** Raw 32-byte Ed25519 public key, base64 - embedded in every pack. */
export const packPublicKeyBase64 = publicKeyDer
  .subarray(SPKI_PREFIX.length)
  .toString('base64');

/** Signs the canonical manifest bytes; returns base64. */
export const signManifest = (canonicalJson: string): string =>
  crypto
    .sign(null, Buffer.from(canonicalJson, 'utf8'), privateKey)
    .toString('base64');

/** Verification helper (used by tests; recipients can do the same). */
export const verifyManifest = (
  canonicalJson: string,
  signatureBase64: string,
): boolean =>
  crypto.verify(
    null,
    Buffer.from(canonicalJson, 'utf8'),
    crypto.createPublicKey({
      key: Buffer.concat([
        SPKI_PREFIX,
        Buffer.from(packPublicKeyBase64, 'base64'),
      ]),
      format: 'der',
      type: 'spki',
    }),
    Buffer.from(signatureBase64, 'base64'),
  );
