import type { Request, Response } from 'express';
import * as scheduleService from '../services/schedule.service.ts';
import type { ScheduleResponse } from '../types/schedule.ts';
import { AppError } from '../utils/AppError.ts';
import { scheduleQuerySchema } from '../validators/schedule.validator.ts';

// En Express 5 req.query es de solo lectura: se valida aquí y se usa el resultado
export async function getSchedules(req: Request, res: Response<ScheduleResponse>): Promise<void> {
  const query = scheduleQuerySchema.safeParse(req.query);
  if (!query.success) {
    throw new AppError(400, 'VALIDATION_ERROR', query.error.issues.map((i) => i.message).join('; '));
  }
  res.json(await scheduleService.getDepartures(query.data, req.log));
}
