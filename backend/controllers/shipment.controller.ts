import type { Request, Response } from 'express';
import * as shipmentService from '../services/shipment.service.ts';
import type { ShipmentDetail } from '../services/shipment.service.ts';

// Seguimiento de un envío: datos, vuelo con aeropuertos e historial (el 404 lo lanza el service)
export async function getShipment(
  req: Request<{ trackingCode: string }>,
  res: Response<ShipmentDetail>,
): Promise<void> {
  res.json(await shipmentService.getByTrackingCode(req.params.trackingCode));
}
