import { Router } from 'express';
import { getTracking } from '../controllers/tracking.controller.ts';
import { validateParams } from '../middlewares/validate.ts';
import { trackingCodeParamsSchema } from '../validators/shipment.validator.ts';

export const trackingRouter = Router();

// Sin requireAuth: el código de seguimiento es la llave, igual que GET /api/shipments/:trackingCode
trackingRouter.get('/:trackingCode', validateParams(trackingCodeParamsSchema), getTracking);
