import type { Request, Response } from 'express';
import * as trustedContactService from '../services/trustedContact.service';
import { authContext } from '../middlewares/auth.middleware';
import type { TrustedContactInput } from '../validation/trustedContact.schema';

export const create = async (req: Request, res: Response): Promise<void> => {
  const contact = await trustedContactService.create(
    authContext(req).userId,
    req.body as TrustedContactInput,
  );
  res.status(201).json({ contact: contact.toJSON() });
};

export const list = async (req: Request, res: Response): Promise<void> => {
  const contacts = await trustedContactService.list(authContext(req).userId);
  res
    .status(200)
    .json({ contacts: contacts.map((contact) => contact.toJSON()) });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  await trustedContactService.remove(authContext(req).userId, id);
  res.status(204).send();
};

export const resend = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  await trustedContactService.resendNomination(authContext(req).userId, id);
  res.status(204).send();
};

/**
 * The contact clicks this in their mail client, so the response is a tiny
 * human-readable page, not a JSON envelope.
 */
export const respond = async (req: Request, res: Response): Promise<void> => {
  const { token, action } = req.params as {
    token: string;
    action: 'accept' | 'decline';
  };
  const contact = await trustedContactService.respond(token, action);

  const message =
    contact.consentState === 'opted_in'
      ? `Thank you, ${contact.name}. You will receive an email alert if this phone is ever stolen. You can opt out from any alert email.`
      : `Understood, ${contact.name}. You will not receive any alerts, and you will not be contacted again.`;

  res
    .status(200)
    .type('html')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tambo</title></head>` +
        `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.6">` +
        `<h1 style="font-size:1.3rem">Tambo</h1><p>${message}</p></body></html>`,
    );
};
