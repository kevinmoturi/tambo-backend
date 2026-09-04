import type { MailMessage, Mailer } from './mailer.interface';

/** Test driver: records what would have been sent, delivers nothing. */
class NoopMailer implements Mailer {
  public readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export const noopMailer = new NoopMailer();
