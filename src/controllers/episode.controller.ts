import type { Request, Response } from 'express';
import * as episodeService from '../services/episode.service';
import { authContext } from '../middlewares/auth.middleware';

export const list = async (req: Request, res: Response): Promise<void> => {
  const { deviceId } = req.query as { deviceId?: string };
  const episodes = await episodeService.list(authContext(req).userId, deviceId);
  res
    .status(200)
    .json({ episodes: episodes.map((episode) => episode.toJSON()) });
};

export const get = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const episode = await episodeService.getOwned(authContext(req).userId, id);
  res.status(200).json({ episode: episode.toJSON() });
};
