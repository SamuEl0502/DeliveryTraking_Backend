import { Router } from 'express';
import { getSchedules, importSchedules } from '../controllers/schedule.controller.ts';
import { requireAuth, requireRole } from '../middlewares/auth.ts';

export const scheduleRouter = Router();

// Cada consulta puede gastar créditos de AirLabs: solo para Staff y Admin
scheduleRouter.use(requireAuth, requireRole('STAFF', 'ADMIN'));

scheduleRouter.get('/', getSchedules);
// Guarda las salidas de la ruta como vuelos (solo inserta los nuevos)
scheduleRouter.post('/import', importSchedules);
