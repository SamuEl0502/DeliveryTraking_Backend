import type { Request, Response } from 'express';
import * as aircraftService from '../services/aircraft.service.ts';
import * as flightDetailsService from '../services/flightDetails.service.ts';

// Express 5 envía al errorHandler cualquier error de una función async, sin try/catch
// ?airline=FDX (código ICAO de la aerolínea, en el indicativo) deja solo sus aviones
export async function listAircraft(req: Request, res: Response): Promise<void> {
  const snapshot = await aircraftService.getUsAircraft(req.log);
  const aircraft = aircraftService.byAirline(snapshot.aircraft, req.query.airline);
  res.json({ time: snapshot.time, count: aircraft.length, aircraft });
}

export async function getAircraft(req: Request<{ icao24: string }>, res: Response): Promise<void> {
  const aircraft = await aircraftService.getAircraftByIcao24(req.params.icao24, req.log);
  res.json(aircraft);
}

// Panel del avión seleccionado: datos en vivo + avión + ruta + progreso (sin gastar Aviationstack)
export async function getAircraftDetails(req: Request<{ icao24: string }>, res: Response): Promise<void> {
  res.json(await flightDetailsService.getDetails(req.params.icao24, req.log));
}

// Horarios bajo demanda: ruta real y horarios; es la única que gasta peticiones de Aviationstack
export async function getAircraftSchedule(req: Request<{ icao24: string }>, res: Response): Promise<void> {
  res.json(await flightDetailsService.getSchedule(req.params.icao24, req.log));
}

// Recorrido desde el despegue para la estela con colores por altitud (4 créditos de OpenSky, caché de 1 min)
export async function getAircraftTrack(req: Request<{ icao24: string }>, res: Response): Promise<void> {
  res.json(await aircraftService.getTrack(req.params.icao24, req.log));
}
