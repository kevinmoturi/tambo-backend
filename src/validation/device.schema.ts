import { z } from 'zod';

/**
 * IMEIs are owner-entered (Android 10+ blocks reading them), so validate shape
 * without being pedantic: 14-16 digits covers IMEI and IMEISV as printed on
 * boxes and in dialers. No Luhn check - a typo'd but plausible IMEI is the
 * owner's to correct, and rejecting real-world variants costs more than it saves.
 */
const imei = z
  .string()
  .trim()
  .regex(/^\d{14,16}$/, 'An IMEI is 14-16 digits.');

const name = z.string().trim().min(1, 'Name is required.').max(80);
const shortText = z.string().trim().min(1).max(80);

export const deviceSchema = z.object({
  /** What the owner calls it: "My Tecno", "Mum's phone". */
  name,
  imeis: z.array(imei).min(1, 'At least one IMEI is required.').max(2),
  make: shortText,
  deviceModel: shortText,
  colour: shortText.optional(),
  purchaseInfo: z.string().trim().min(1).max(500).optional(),
});

export const deviceUpdateSchema = deviceSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field to update.',
  );

export const deviceIdSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid device id.'),
});

export const markStolenSchema = z.object({
  note: z.string().trim().min(1).max(1000).optional(),
});

export const episodeIdSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid episode id.'),
});

export const episodeListQuerySchema = z.object({
  deviceId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, 'Invalid device id.')
    .optional(),
});

export type DeviceInput = z.infer<typeof deviceSchema>;
export type DeviceUpdateInput = z.infer<typeof deviceUpdateSchema>;
