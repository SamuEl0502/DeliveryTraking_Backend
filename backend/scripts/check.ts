import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localToIso, toActiveFlight } from '../providers/aviationStack.provider.ts';
import { bearingDeg, computeProgress, distanceKm } from '../services/flightDetails.service.ts';
import type { AircraftState } from '../types/aircraft.ts';

// Prueba rápida del panel (geometría y elección del vuelo de Aviationstack): npm run check
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

// recorrido + restante = total
assert.equal(mid.progress.flownKm + mid.progress.remainingKm - mid.progress.totalKm <= 1, true);

// En Texas, lejos de la ruta: no verificada
assert.equal(computeProgress(plane(32.8, -97.0), route).verified, false);

// En la ruta pero volando al revés (rumbo oeste, destino al este): no verificada
const backwards = { ...plane(42.2, -79.5), hdg: 270 };
assert.equal(computeProgress(backwards, route).verified, false);

// Caso real reportado: UAL19 "JFK→SFO" sobre el Atlántico con rumbo 55°: no verificada
const jfk = { icao: 'KJFK', iata: 'JFK', name: 'JFK', city: 'New York', lat: 40.6398, lng: -73.7789 };
const sfo = { icao: 'KSFO', iata: 'SFO', name: 'SFO', city: 'San Francisco', lat: 37.619, lng: -122.375 };
const ual19 = { ...plane(43.8, -66.53), hdg: 55 };
assert.equal(computeProgress(ual19, { ...route, origin: jfk, destination: sfo }).verified, false);

// De ORD a BOS se vuela casi al este: rumbo inicial ~80°
assert.ok(Math.abs(bearingDeg(ord, bos) - 80) < 10);

// Sin velocidad no hay ETA
assert.equal(computeProgress(plane(42.2, -79.5, null), route).progress.etaMinutes, null);

// Aviationstack: respuesta real de AAL3304 con 2 códigos compartidos (Aer Lingus, Finnair) sobre el mismo avión
const sample: unknown = JSON.parse(readFileSync(new URL('../fixtures/aviationstack-sample.json', import.meta.url), 'utf8'));
const flight = toActiveFlight(sample, 'aae316', 'AAL3304');
assert.equal(flight?.flightNumber, 'AA3304');
assert.equal(flight?.airline, 'American Airlines');
assert.equal(flight?.departure.airport?.iata, 'MIA');
assert.equal(flight?.arrival.airport?.iata, 'ORD');
assert.equal(flight?.departure.delayMinutes, 30);
// Horas locales -> UTC: MIA 17:40 (UTC-4) = 21:40Z; ORD 19:55 (UTC-5) = 00:55Z del día siguiente
assert.equal(flight?.departure.actual, '2026-10-19T21:40:00.000Z');
assert.equal(flight?.arrival.scheduled, '2026-10-20T00:55:00.000Z');
// Cambio de horario: en enero Nueva York es UTC-5
assert.equal(localToIso('2026-01-15T08:00:00+00:00', 'America/New_York'), '2026-01-15T13:00:00.000Z');
assert.equal(toActiveFlight({ data: [] }, 'aae316', 'AAL3304'), null);

console.log('check OK');
