import { Router } from 'express';
import {
  createShipment,
  getMyShipments,
  getShipment,
  listAvailableFlights,
  listShipments,
} from '../controllers/shipment.controller.ts';
import { requireAuth, requireRole } from '../middlewares/auth.ts';
import { validateParams } from '../middlewares/validate.ts';
import { trackingCodeParamsSchema } from '../validators/shipment.validator.ts';

export const shipmentRouter = Router();

shipmentRouter.get('/', requireAuth, requireRole('STAFF', 'ADMIN'), listShipments);
shipmentRouter.post('/', requireAuth, requireRole('CLIENT'), createShipment);
// Antes de /:trackingCode, que también coincidiría con estas rutas
shipmentRouter.get('/available-flights', requireAuth, requireRole('CLIENT'), listAvailableFlights);
shipmentRouter.get('/mine', requireAuth, getMyShipments);
shipmentRouter.get('/:trackingCode', validateParams(trackingCodeParamsSchema), getShipment);
