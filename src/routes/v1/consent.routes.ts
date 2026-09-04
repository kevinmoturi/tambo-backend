import { Router } from 'express';
import * as trustedContactController from '../../controllers/trustedContact.controller';
import { rateLimit } from '../../middlewares/rateLimit';
import { validate } from '../../middlewares/validate';
import { consentParamsSchema } from '../../validation/trustedContact.schema';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

/**
 * PUBLIC: the trusted contact clicks these from their mailbox; they have no
 * account. GET because mail clients follow links with GET - the token is
 * single-use (atomic claim), so prefetchers cannot half-consume it twice.
 */
router.get(
  '/:token/:action',
  validate({ params: consentParamsSchema }),
  rateLimit({ name: 'consent' }),
  asyncHandler(trustedContactController.respond),
);

export default router;
