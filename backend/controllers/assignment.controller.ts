import type { Request, Response } from 'express';
import * as assignmentService from '../services/assignment.service.ts';
import type { ShipmentDetail } from '../services/shipment.service.ts';
import type { AuthUser } from '../services/token.service.ts';
import { AppError } from '../utils/AppError.ts';
import { createAssignmentBodySchema } from '../validators/assignment.validator.ts';

function actorOf(req: Pick<Request, 'user'>): AuthUser {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
  }
  return req.user;
}

// Asigna o reasigna, según si el envío ya tenía vuelo
export async function createAssignment(req: Request, res: Response<ShipmentDetail>): Promise<void> {
  const actor = actorOf(req);
  const body = createAssignmentBodySchema.safeParse(req.body);
  if (!body.success) {
    throw new AppError(400, 'VALIDATION_ERROR', body.error.issues.map((i) => i.message).join('; '));
  }
  res.json(await assignmentService.assign(body.data, actor));
}

export async function deleteAssignment(
  req: Request<{ shipmentId: string }>,
  res: Response<ShipmentDetail>,
): Promise<void> {
  res.json(await assignmentService.unassign(req.params.shipmentId, actorOf(req)));
}
