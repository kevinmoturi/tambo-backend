import { Router } from 'express';
import * as trustedContactController from '../../controllers/trustedContact.controller';
import { requireAuth } from '../../middlewares/auth.middleware';
import { rateLimit } from '../../middlewares/rateLimit';
import { validate } from '../../middlewares/validate';
import {
  contactIdSchema,
  trustedContactSchema,
} from '../../validation/trustedContact.schema';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

router.use(requireAuth);

// nominations email a third party - budgeted so Tambo can't be used to pester
router.post(
  '/',
  validate({ body: trustedContactSchema }),
  rateLimit({ name: 'contactNomination' }),
  asyncHandler(trustedContactController.create),
);
router.get('/', asyncHandler(trustedContactController.list));
router.delete(
  '/:id',
  validate({ params: contactIdSchema }),
  asyncHandler(trustedContactController.remove),
);
router.post(
  '/:id/resend',
  validate({ params: contactIdSchema }),
  rateLimit({ name: 'contactNomination' }),
  asyncHandler(trustedContactController.resend),
);

export default router;
