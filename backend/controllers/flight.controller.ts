import type { Request, Response } from 'express';
import * as flightService from '../services/flight.service.ts';
import type { AuthUser } from '../services/token.service.ts';
import type { Flight, FlightList } from '../types/flight.ts';
import { AppError } from '../utils/AppError.ts';
import {
  flightAircraftBodySchema,
  flightAircraftUnlinkBodySchema,
  flightListQuerySchema,
} from '../validators/flight.validator.ts';

// En Express 5 req.query es de solo lectura: se valida aquí y se usa el resultado
export async function listFlights(req: Request, res: Response<FlightList>): Promise<void> {
  const query = flightListQuerySchema.safeParse(req.query);
  if (!query.success) {
    throw new AppError(400, 'VALIDATION_ERROR', query.error.issues.map((i) => i.message).join('; '));
  }
  res.json(await flightService.list(query.data));
}

export async function getFlight(req: Request<{ id: string }>, res: Response<Flight>): Promise<void> {
  res.json(await flightService.getById(req.params.id));
}

// requireAuth ya se ejecutó en estas rutas, así que req.user existe
function actorOf(req: Request): AuthUser {
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
  return req.user;
}

export async function setFlightAircraft(req: Request<{ id: string }>, res: Response<Flight>): Promise<void> {
  const body = flightAircraftBodySchema.safeParse(req.body);
  if (!body.success) {
    throw new AppError(400, 'VALIDATION_ERROR', body.error.issues.map((i) => i.message).join('; '));
  }
  res.json(await flightService.setAircraft(req.params.id, body.data, actorOf(req), req.log));
}

export async function unsetFlightAircraft(req: Request<{ id: string }>, res: Response<Flight>): Promise<void> {
  const body = flightAircraftUnlinkBodySchema.safeParse(req.body);
  if (!body.success) {
    throw new AppError(400, 'VALIDATION_ERROR', body.error.issues.map((i) => i.message).join('; '));
  }
  res.json(await flightService.unsetAircraft(req.params.id, body.data.expectedVersion, actorOf(req)));
}
