import { Router } from 'express';
import { getFlight, listFlights } from '../controllers/flight.controller.ts';
import { requireAuth, requireRole } from '../middlewares/auth.ts';
import { validateParams } from '../middlewares/validate.ts';
import { flightIdParamsSchema } from '../validators/flight.validator.ts';

export const flightRouter = Router();

// La capacidad de los vuelos es un dato de operación: solo para Staff
flightRouter.use(requireAuth, requireRole('STAFF'));

flightRouter.get('/', listFlights);
flightRouter.get('/:id', validateParams(flightIdParamsSchema), getFlight);
