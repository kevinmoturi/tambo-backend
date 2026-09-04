import { Router } from 'express';
import * as episodeController from '../../controllers/episode.controller';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate';
import {
  episodeIdSchema,
  episodeListQuerySchema,
} from '../../validation/device.schema';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  validate({ query: episodeListQuerySchema }),
  asyncHandler(episodeController.list),
);
router.get(
  '/:id',
  validate({ params: episodeIdSchema }),
  asyncHandler(episodeController.get),
);

export default router;
