// Contrato de un avión en la API (el frontend usa el mismo tipo)
export interface AircraftState {
  icao24: string;
  callsign: string | null;
  lat: number;
  lng: number;
  /** Rumbo en grados desde el norte, sentido horario */
  hdg: number | null;
  /** Velocidad en m/s */
  spd: number | null;
  /** Altitud en metros */
  alt: number | null;
  onGround: boolean;
  /** Tipo ICAO del avión (B738, A321, C172...); null si no está en la base de aeronaves */
  type: string | null;
  /** Momento de la posición, Unix en segundos */
  ts: number;
}

export interface AircraftSnapshot {
  /** Momento del lote según OpenSky, Unix en segundos */
  time: number;
  aircraft: AircraftState[];
}
