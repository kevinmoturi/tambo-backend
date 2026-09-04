import config from '../../config/config';
import type { Mailer } from './mailer.interface';

/**
 * Resend (https://resend.com) driver over its plain HTTP API - no SDK
 * dependency for a single POST.
 *
 * Until a sending domain is verified in Resend, the account is in onboarding
 * mode: `from` must be onboarding@resend.dev and mail can only reach the
 * Resend account owner's own address. Verify the domain (see
 * docs/cloudflare.md), then set MAIL_FROM to an address on it.
 */
export const resendMailer: Mailer = {
  send: async (message) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.mail.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.mail.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Resend rejected the send (${response.status}): ${detail}`,
      );
    }
  },
};
