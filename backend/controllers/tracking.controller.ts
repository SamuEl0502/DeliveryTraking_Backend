import type { Request, Response } from 'express';
import * as trackingService from '../services/tracking.service.ts';
import type { ShipmentTracking } from '../types/tracking.ts';

// Público: quien tenga el código ve el estado y la posición en vivo; sin posición responde 200 con live: null
export async function getTracking(
  req: Request<{ trackingCode: string }>,
  res: Response<ShipmentTracking>,
): Promise<void> {
  res.json(await trackingService.getByTrackingCode(req.params.trackingCode, req.log));
}
