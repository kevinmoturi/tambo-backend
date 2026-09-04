export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * The seam between "we decided to notify someone" and "a vendor delivered it".
 * Adding Resend/SES later means one new file implementing this and one line in
 * index.ts - no call site changes.
 */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
