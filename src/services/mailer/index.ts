import config from '../../config/config';
import { consoleMailer } from './console.mailer';
import { noopMailer } from './noop.mailer';
import type { Mailer } from './mailer.interface';

/**
 * config.mail.driver is validated at boot (an unknown MAIL_DRIVER refuses to
 * start), so this selection is exhaustive - there is no silent fallback that
 * could route production reset links to stdout.
 */
export const mailer: Mailer =
  config.mail.driver === 'noop' ? noopMailer : consoleMailer;
export type { Mailer, MailMessage } from './mailer.interface';
