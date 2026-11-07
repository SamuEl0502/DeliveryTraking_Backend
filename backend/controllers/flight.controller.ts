import type { Request, Response } from 'express';
import * as flightService from '../services/flight.service.ts';
import type { Flight, FlightList } from '../types/flight.ts';
import { AppError } from '../utils/AppError.ts';
import { flightListQuerySchema } from '../validators/flight.validator.ts';

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
