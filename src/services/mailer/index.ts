import config from '../../config/config';
import { consoleMailer } from './console.mailer';
import { noopMailer } from './noop.mailer';
import { resendMailer } from './resend.mailer';
import type { Mailer } from './mailer.interface';

/**
 * config.mail.driver is validated at boot (an unknown MAIL_DRIVER refuses to
 * start), so this selection is exhaustive - there is no silent fallback that
 * could route production codes or reset links to stdout.
 */
const drivers: Record<typeof config.mail.driver, Mailer> = {
  console: consoleMailer,
  noop: noopMailer,
  resend: resendMailer,
};

export const mailer: Mailer = drivers[config.mail.driver];
export type { Mailer, MailMessage } from './mailer.interface';
