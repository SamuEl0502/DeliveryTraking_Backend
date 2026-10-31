import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.ts';
import { correlationId } from './middlewares/correlationId.ts';
import { rateLimiter } from './middlewares/rateLimiter.ts';
import { errorHandler, notFound } from './middlewares/errorHandler.ts';
import { healthRouter } from './routes/health.routes.ts';
import { aircraftRouter } from './routes/aircraft.routes.ts';
import { shipmentRouter } from './routes/shipment.routes.ts';

export const app = express();

// El orden importa: correlationId primero para que todo lo demás tenga id
app.use(correlationId);
app.use(helmet());
// CORS_ORIGIN admite varios orígenes separados por coma
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
app.use(express.json({ limit: '100kb' }));

// /health fuera del rate limit para que un monitor pueda consultarlo siempre
app.use('/health', healthRouter);

app.use('/api', rateLimiter);
app.use('/api/aircraft', aircraftRouter);
app.use('/api/shipments', shipmentRouter);

// Siempre al final: 404 y luego el manejador global de errores
app.use(notFound);
app.use(errorHandler);
