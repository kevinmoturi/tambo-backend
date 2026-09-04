import type { Request, RequestHandler } from 'express';
import * as deviceService from '../services/device.service';
import type { IDevice } from '../models/device.model';
import { AppError } from '../utils/appError';

/**
 * Authenticates a DEVICE (not a user) via its ingest token in X-Device-Token.
 * This is the credential evidence upload rides on: valid on a stolen phone
 * even after the owner's sessions are revoked, and worthless for anything but
 * ingest if it leaks.
 */
export const requireDeviceToken: RequestHandler = (req, _res, next) => {
  const token = req.get('x-device-token');

  if (!token) {
    next(
      AppError.unauthorized('Missing device token.', 'missing_device_token'),
    );
    return;
  }

  deviceService
    .findByIngestToken(token)
    .then((device) => {
      if (!device) {
        next(
          AppError.unauthorized(
            'Invalid device token.',
            'invalid_device_token',
          ),
        );
        return;
      }
      req.device = device;
      next();
    })
    .catch(next);
};

/** Narrows `req.device` for handlers mounted behind requireDeviceToken. */
export const deviceContext = (req: Request): IDevice => {
  if (!req.device) throw AppError.unauthorized();
  return req.device;
};
