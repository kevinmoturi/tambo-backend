import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'));

export const buddySchema = z.object({
  email,
  /** Optional display name until the buddy is a linked account with its own name. */
  name: z.string().trim().min(1).max(120).optional(),
});

export const buddyIdSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid buddy id.'),
});

export const inviteActionSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid invitation id.'),
  action: z.enum(['accept', 'decline']),
});

export type BuddyInput = z.infer<typeof buddySchema>;
