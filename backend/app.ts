import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.ts';
import { correlationId } from './middlewares/correlationId.ts';
import { rateLimiter } from './middlewares/rateLimiter.ts';
import { errorHandler, notFound } from './middlewares/errorHandler.ts';
import { healthRouter } from './routes/health.routes.ts';
import { aircraftRouter } from './routes/aircraft.routes.ts';
import { shipmentRouter } from './routes/shipment.routes.ts';
import { authRouter } from './routes/auth.routes.ts';

export const app = express();

// El orden importa: correlationId primero para que todo lo demás tenga id
app.use(correlationId);
app.use(helmet());
// CORS_ORIGIN admite varios orígenes separados por coma
// credentials: el navegador manda la cookie del refresh token solo si el servidor lo permite
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true }));
app.use(express.json({ limit: '100kb' }));
// Lee las cookies en req.cookies (aquí solo viaja el refresh token)
app.use(cookieParser());

// /health fuera del rate limit para que un monitor pueda consultarlo siempre
app.use('/health', healthRouter);

app.use('/api', rateLimiter);
app.use('/api/aircraft', aircraftRouter);
app.use('/api/shipments', shipmentRouter);
app.use('/api/auth', authRouter);

// Siempre al final: 404 y luego el manejador global de errores
app.use(notFound);
app.use(errorHandler);
