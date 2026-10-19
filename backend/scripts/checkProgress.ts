import assert from 'node:assert/strict';
import { computeProgress, distanceKm } from '../services/flightDetails.service.ts';
import type { AircraftState } from '../types/aircraft.ts';

// Prueba rápida de la geometría del panel: npm run check
const ord = { lat: 41.9786, lng: -87.9048 };
const bos = { lat: 42.3643, lng: -71.0052 };
const route = {
  callsign: 'UAL1855',
  flightNumber: 'UA1855',
  airline: null,
  origin: { icao: 'KORD', iata: 'ORD', name: "O'Hare", city: 'Chicago', ...ord },
  destination: { icao: 'KBOS', iata: 'BOS', name: 'Logan', city: 'Boston', ...bos },
};
const plane = (lat: number, lng: number, spd: number | null = 230): AircraftState => ({
  icao24: 'a39bfa', callsign: 'UAL1855', lat, lng, hdg: 90, spd, alt: 11000, onGround: false, ts: 0,
});

// ORD-BOS son ~1390 km
assert.ok(Math.abs(distanceKm(ord, bos) - 1390) < 15);

// A mitad de camino (Ohio): ruta verificada, ~50 %, ETA = 695 km / (230 m/s * 0.06) ≈ 50 min
const mid = computeProgress(plane(42.2, -79.5), route);
assert.equal(mid.verified, true);
assert.ok(mid.progress.percent > 40 && mid.progress.percent < 60);
assert.ok(mid.progress.etaMinutes !== null && mid.progress.etaMinutes > 40 && mid.progress.etaMinutes < 60);

// En Texas, lejos de la ruta: no verificada
assert.equal(computeProgress(plane(32.8, -97.0), route).verified, false);

// Sin velocidad no hay ETA
assert.equal(computeProgress(plane(42.2, -79.5, null), route).progress.etaMinutes, null);

console.log('checkProgress OK');
