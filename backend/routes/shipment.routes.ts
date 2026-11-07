import { Router } from 'express';
import { createShipment, getShipment, listAvailableFlights } from '../controllers/shipment.controller.ts';
import { requireAuth, requireRole } from '../middlewares/auth.ts';
import { validateParams } from '../middlewares/validate.ts';
import { trackingCodeParamsSchema } from '../validators/shipment.validator.ts';

export const shipmentRouter = Router();

shipmentRouter.post('/', requireAuth, requireRole('CLIENT'), createShipment);
// Antes de /:trackingCode, que también coincidiría con esta ruta
shipmentRouter.get('/available-flights', requireAuth, requireRole('CLIENT'), listAvailableFlights);
shipmentRouter.get('/:trackingCode', validateParams(trackingCodeParamsSchema), getShipment);
