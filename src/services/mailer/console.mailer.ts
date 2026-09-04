import type { Mailer } from './mailer.interface';

/** Development driver: prints the message so you can click the link from the terminal. */
export const consoleMailer: Mailer = {
  send: async (message) => {
    const attachments = message.attachments?.length
      ? `\nattachments: ${message.attachments.map((a) => a.filename).join(', ')}`
      : '';
    console.log(
      [
        '',
        '--- MAIL ---',
        `to:      ${message.to}`,
        `subject: ${message.subject}`,
        message.text + attachments,
        '--- END MAIL ---',
        '',
      ].join('\n'),
    );
  },
};
