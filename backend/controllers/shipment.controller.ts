import type { Request, Response } from 'express';
import type { z } from 'zod';
import * as shipmentService from '../services/shipment.service.ts';
import type { ShipmentDetail } from '../services/shipment.service.ts';
import type { AvailableFlightList, ShipmentList } from '../types/shipment.ts';
import { AppError } from '../utils/AppError.ts';
import { flightListQuerySchema } from '../validators/flight.validator.ts';
import {
  createShipmentBodySchema,
  myShipmentsQuerySchema,
  shipmentListQuerySchema,
} from '../validators/shipment.validator.ts';

// Mismo formato de error que validateParams
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

// Seguimiento de un envío: datos, vuelo con aeropuertos e historial (el 404 lo lanza el service)
export async function getShipment(
  req: Request<{ trackingCode: string }>,
  res: Response<ShipmentDetail>,
): Promise<void> {
  res.json(await shipmentService.getByTrackingCode(req.params.trackingCode));
}

// El dueño siempre sale del token: el body no puede crear envíos a nombre de otro usuario
export async function createShipment(req: Request, res: Response<ShipmentDetail>): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
  }
  const input = parse(createShipmentBodySchema, req.body);
  res.status(201).json(await shipmentService.create(input, req.user.id));
}

// Envíos del usuario del token; nunca de un id que llegue en la URL
export async function getMyShipments(req: Request, res: Response<ShipmentList>): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
  }
  res.json(await shipmentService.listMine(req.user.id, parse(myShipmentsQuerySchema, req.query)));
}

// Listado de Staff y Admin; el alcance por aeropuerto lo decide el service según el rol
export async function listShipments(req: Request, res: Response<ShipmentList>): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
  }
  res.json(await shipmentService.list(req.user, parse(shipmentListQuerySchema, req.query)));
}

// Vuelos que el cliente puede elegir al crear un envío; de aquí obtiene el flightId
export async function listAvailableFlights(req: Request, res: Response<AvailableFlightList>): Promise<void> {
  res.json(await shipmentService.listAvailableFlights(parse(flightListQuerySchema, req.query)));
}
