import { Router } from 'express';
import { getSchedules } from '../controllers/schedule.controller.ts';
import { requireAuth, requireRole } from '../middlewares/auth.ts';

export const scheduleRouter = Router();

// Cada consulta puede gastar créditos de AirLabs: solo para Staff y Admin
scheduleRouter.use(requireAuth, requireRole('STAFF', 'ADMIN'));

scheduleRouter.get('/', getSchedules);
