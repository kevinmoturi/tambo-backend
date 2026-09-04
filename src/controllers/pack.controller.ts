import type { Request, Response } from 'express';
import * as deliveryService from '../services/delivery.service';
import * as packService from '../services/pack.service';
import { renderPackPdf } from '../services/pack.pdf';
import { authContext } from '../middlewares/auth.middleware';

export const getJson = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const pack = await packService.buildPack(authContext(req).userId, id);
  res.status(200).json({ pack });
};

export const getPdf = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const pack = await packService.buildPack(authContext(req).userId, id);
  const pdf = await renderPackPdf(pack);

  res
    .status(200)
    .type('application/pdf')
    .set(
      'Content-Disposition',
      `attachment; filename="tambo-evidence-${id}.pdf"`,
    )
    .send(pdf);
};

export const send = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const result = await deliveryService.sendPack(authContext(req).userId, id);
  res.status(200).json(result);
};
