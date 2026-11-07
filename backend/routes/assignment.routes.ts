import { Router } from 'express';
import { createAssignment, deleteAssignment } from '../controllers/assignment.controller.ts';
import { requireAuth, requireRole } from '../middlewares/auth.ts';
import { validateParams } from '../middlewares/validate.ts';
import { assignmentShipmentParamsSchema } from '../validators/assignment.validator.ts';

export const assignmentRouter = Router();

assignmentRouter.use(requireAuth, requireRole('STAFF', 'ADMIN'));

assignmentRouter.post('/', createAssignment);
assignmentRouter.delete('/:shipmentId', validateParams(assignmentShipmentParamsSchema), deleteAssignment);
