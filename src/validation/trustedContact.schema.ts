import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'));

export const trustedContactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email,
  /** Loose E.164-ish shape; stored for the WhatsApp future, unused in v1. */
  phone: z
    .string()
    .trim()
    .regex(/^\+?\d{7,15}$/, 'Enter a valid phone number.')
    .optional(),
});

export const contactIdSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid contact id.'),
});

export const consentParamsSchema = z.object({
  token: z.string().regex(/^[a-f\d]{40,128}$/i, 'Invalid token.'),
  action: z.enum(['accept', 'decline']),
});

export type TrustedContactInput = z.infer<typeof trustedContactSchema>;
