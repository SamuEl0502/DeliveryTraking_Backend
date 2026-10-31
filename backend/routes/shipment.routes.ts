import { Router } from 'express';
import { getShipment } from '../controllers/shipment.controller.ts';
import { validateParams } from '../middlewares/validate.ts';
import { trackingCodeParamsSchema } from '../validators/shipment.validator.ts';

export const shipmentRouter = Router();

shipmentRouter.get('/:trackingCode', validateParams(trackingCodeParamsSchema), getShipment);
