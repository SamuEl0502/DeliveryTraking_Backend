// El avión puede volar otro tramo antes o después: solo cuenta lo que pase cerca de la hora programada
const TAKEOFF_EARLY_MS = 60 * 60_000;
const TAKEOFF_LATE_MS = 6 * 60 * 60_000;

/** true desde 60 min antes hasta 6 h después de la salida programada */
export function inTakeoffWindow(scheduledDeparture: Date, now: number): boolean {
  const departure = scheduledDeparture.getTime();
  return now >= departure - TAKEOFF_EARLY_MS && now <= departure + TAKEOFF_LATE_MS;
}
