import type { Mailer } from './mailer.interface';

/** Development driver: prints the message so you can click the link from the terminal. */
export const consoleMailer: Mailer = {
  send: async (message) => {
    console.log(
      [
        '',
        '--- MAIL ---',
        `to:      ${message.to}`,
        `subject: ${message.subject}`,
        message.text,
        '--- END MAIL ---',
        '',
      ].join('\n'),
    );
  },
};
