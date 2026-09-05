import { Router } from 'express';
import * as buddyController from '../../controllers/buddy.controller';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate';
import { inviteActionSchema } from '../../validation/buddy.schema';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
router.use(requireAuth);

// the buddy's own view: invitations addressed to them, and their in-app answer
router.get('/', asyncHandler(buddyController.listInvites));
router.post(
  '/:id/:action',
  validate({ params: inviteActionSchema }),
  asyncHandler(buddyController.respond),
);

export default router;
