import { Router } from 'express';
import * as buddyController from '../../controllers/buddy.controller';
import { requireAuth } from '../../middlewares/auth.middleware';
import { rateLimit } from '../../middlewares/rateLimit';
import { validate } from '../../middlewares/validate';
import { buddyIdSchema, buddySchema } from '../../validation/buddy.schema';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
router.use(requireAuth);

// invites email a person; budgeted so Tambo can't be used to pester a mailbox
router.post(
  '/',
  validate({ body: buddySchema }),
  rateLimit({ name: 'buddyInvite' }),
  asyncHandler(buddyController.invite),
);
router.get('/', asyncHandler(buddyController.list));
router.delete(
  '/:id',
  validate({ params: buddyIdSchema }),
  asyncHandler(buddyController.remove),
);

export default router;
