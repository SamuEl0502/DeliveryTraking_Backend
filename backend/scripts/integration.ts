import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { FlightStatus, Role, ShipmentStatus } from '@prisma/client';
import type { ShipmentDetail } from '../services/shipment.service.ts';
import type { Flight } from '../types/flight.ts';

// Pruebas contra la API y PostgreSQL de verdad: npm run test:integration
// Crean sus propios datos y los borran al terminar; no dependen del seed ni lo modifican

// Antes de importar la app, porque el logger lee el nivel al cargar
process.env.LOG_LEVEL = 'fatal';
const { app } = await import('../app.ts');
const { env } = await import('../config/env.ts');
const { prisma } = await import('../config/prisma.ts');
const { signAccessToken } = await import('../services/token.service.ts');

if (env.NODE_ENV === 'production') {
  throw new Error('las pruebas de integración no se pueden correr con NODE_ENV=production');
}

const EMAIL_DOMAIN = '@integration.test';
const FLIGHT_PREFIX = 'IT-';
const AIRPORT_CODES = ['QZA', 'QZB', 'QZC'];

async function cleanup(): Promise<void> {
  const ownedByTests = { owner: { email: { endsWith: EMAIL_DOMAIN } } };
  await prisma.$transaction([
    prisma.trackingEvent.deleteMany({ where: { shipment: ownedByTests } }),
    prisma.shipment.deleteMany({ where: ownedByTests }),
    prisma.flight.deleteMany({ where: { flightNumber: { startsWith: FLIGHT_PREFIX } } }),
    prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } }),
    prisma.airport.deleteMany({ where: { iataCode: { in: AIRPORT_CODES } } }),
  ]);
}

// Una corrida interrumpida pudo dejar datos
await cleanup();

const server = app.listen(0);
await once(server, 'listening');
const base = `http://localhost:${(server.address() as AddressInfo).port}/api`;

interface ApiResult<T> {
  status: number;
  body: T;
  code: string | undefined;
  message: string | undefined;
}

async function api<T = unknown>(method: string, path: string, token?: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as T & { error?: { code: string; message: string } };
  return { status: res.status, body: json, code: json.error?.code, message: json.error?.message };
}

async function createAirport(iataCode: string): Promise<string> {
  const { id } = await prisma.airport.create({
    data: { iataCode, icaoCode: `${iataCode}A`, name: iataCode, city: iataCode, lat: 0, lng: 0, timezone: 'UTC' },
  });
  return id;
}

async function createUser(name: string, role: Role, airportId: string | null = null): Promise<{ id: string; token: string }> {
  const { id } = await prisma.user.create({
    data: { email: `${name}${EMAIL_DOMAIN}`, name, role, airportId, passwordHash: 'sin-uso' },
  });
  return { id, token: signAccessToken({ id, role }) };
}

const [airportA, airportB, airportC] = [
  await createAirport('QZA'),
  await createAirport('QZB'),
  await createAirport('QZC'),
] as [string, string, string];

const client = await createUser('client', 'CLIENT');
const admin = await createUser('admin', 'ADMIN');
const staffA = await createUser('staff-a', 'STAFF', airportA);
const staffB = await createUser('staff-b', 'STAFF', airportB);
const staffNoAirport = await createUser('staff-none', 'STAFF');

let sequence = 0;

interface FlightOptions {
  capacityKg?: string;
  status?: FlightStatus;
  originId?: string;
  destinationId?: string;
}

async function createFlight(options: FlightOptions = {}): Promise<string> {
  const { capacityKg = '1000', status = 'SCHEDULED', originId = airportA, destinationId = airportB } = options;
  const { id } = await prisma.flight.create({
    data: {
      flightNumber: `${FLIGHT_PREFIX}${++sequence}`,
      capacityKg,
      status,
      originId,
      destinationId,
      scheduledDeparture: new Date('2099-01-01T10:00:00Z'),
      scheduledArrival: new Date('2099-01-01T12:00:00Z'),
    },
  });
  return id;
}

interface ShipmentOptions {
  weightKg?: string;
  flightId?: string | null;
  status?: ShipmentStatus;
  originId?: string;
  destinationId?: string;
}

async function createShipment(options: ShipmentOptions = {}): Promise<string> {
  const { weightKg = '10', flightId = null, status = 'RECEIVED', originId = airportA, destinationId = airportB } = options;
  const { id } = await prisma.shipment.create({
    data: {
      trackingCode: `${FLIGHT_PREFIX}${++sequence}`,
      description: 'Prueba de integración',
      ownerId: client.id,
      weightKg,
      flightId,
      status,
      originId,
      destinationId,
    },
  });
  return id;
}

const assign = (shipmentId: string, flightId: string, expectedFlightVersion: unknown, token = admin.token) =>
  api<ShipmentDetail>('POST', '/assignments', token, { shipmentId, flightId, expectedFlightVersion });

const unassign = (shipmentId: string, token = admin.token) =>
  api<ShipmentDetail>('DELETE', `/assignments/${shipmentId}`, token);

async function getFlight(id: string): Promise<Flight> {
  const res = await api<Flight>('GET', `/flights/${id}`, admin.token);
  assert.equal(res.status, 200);
  return res.body;
}

function assertError(res: ApiResult<unknown>, status: number, code: string): void {
  assert.deepEqual([res.status, res.code], [status, code]);
}

function assertOk(res: ApiResult<unknown>): void {
  assert.equal(res.status, 200, `esperaba 200 y llegó ${res.status} ${res.code}: ${res.message}`);
}

// Todo lo que un rechazo no debe cambiar
async function snapshot(shipmentId: string, flightIds: string[]): Promise<unknown> {
  const shipment = await prisma.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    select: { flightId: true, version: true, _count: { select: { events: true } } },
  });
  const flights = await prisma.flight.findMany({
    where: { id: { in: flightIds } },
    select: { id: true, version: true },
    orderBy: { id: 'asc' },
  });
  return { shipment, flights };
}

async function eventTypes(shipmentId: string): Promise<string[]> {
  const events = await prisma.trackingEvent.findMany({
    where: { shipmentId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { type: true },
  });
  return events.map((e) => e.type);
}

let passed = 0;
const failures: string[] = [];

async function test(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    passed++;
    console.log(`OK    ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`FALLA ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

try {
  // ---------- Capacidad ----------

  await test('capacidad: baja al asignar, sube al desasignar y capacityKg no cambia', async () => {
    const flightId = await createFlight({ capacityKg: '1000' });
    const shipmentId = await createShipment({ weightKg: '250.50' });

    assertOk(await assign(shipmentId, flightId, 0));
    const assigned = await getFlight(flightId);
    assert.deepEqual([assigned.capacityKg, assigned.assignedKg, assigned.remainingCapacityKg], [1000, 250.5, 749.5]);

    assertOk(await unassign(shipmentId));
    const freed = await getFlight(flightId);
    assert.deepEqual([freed.capacityKg, freed.assignedKg, freed.remainingCapacityKg], [1000, 0, 1000]);
  });

  await test('capacidad: se acepta lo que llena justo el vuelo, sin errores de redondeo', async () => {
    const flightId = await createFlight({ capacityKg: '0.30' });
    assertOk(await assign(await createShipment({ weightKg: '0.10' }), flightId, 0));
    assertOk(await assign(await createShipment({ weightKg: '0.20' }), flightId, 1));
    assert.equal((await getFlight(flightId)).remainingCapacityKg, 0);
  });

  await test('capacidad: lo que no cabe da INSUFFICIENT_CAPACITY, indica los kg y no cambia nada', async () => {
    const flightId = await createFlight({ capacityKg: '100' });
    assertOk(await assign(await createShipment({ weightKg: '60' }), flightId, 0));
    const shipmentId = await createShipment({ weightKg: '40.01' });
    const before = await snapshot(shipmentId, [flightId]);

    const res = await assign(shipmentId, flightId, 1);
    assertError(res, 400, 'INSUFFICIENT_CAPACITY');
    assert.match(res.message ?? '', /40\.01 kg.*40 kg/);
    assert.deepEqual(await snapshot(shipmentId, [flightId]), before);
  });

  await test('capacidad: desasignar libera espacio que se puede volver a usar', async () => {
    const flightId = await createFlight({ capacityKg: '100' });
    const first = await createShipment({ weightKg: '100' });
    const second = await createShipment({ weightKg: '100' });
    assertOk(await assign(first, flightId, 0));
    assertError(await assign(second, flightId, 1), 400, 'INSUFFICIENT_CAPACITY');
    assertOk(await unassign(first));
    assertOk(await assign(second, flightId, 2));
  });

  await test('capacidad: reasignar mueve el peso; si no cabe, el vuelo anterior queda intacto', async () => {
    const from = await createFlight({ capacityKg: '1000' });
    const to = await createFlight({ capacityKg: '300' });
    const small = await createShipment({ weightKg: '200' });
    const big = await createShipment({ weightKg: '500', flightId: from });
    assertOk(await assign(small, from, 0));

    assertOk(await assign(small, to, 0));
    assert.deepEqual([(await getFlight(from)).assignedKg, (await getFlight(to)).assignedKg], [500, 200]);

    const before = await snapshot(big, [from, to]);
    assertError(await assign(big, to, 1), 400, 'INSUFFICIENT_CAPACITY');
    assert.deepEqual(await snapshot(big, [from, to]), before);
    assert.deepEqual([(await getFlight(from)).assignedKg, (await getFlight(to)).assignedKg], [500, 200]);
  });

  await test('capacidad: envíos simultáneos de clientes nunca sobrepasan el vuelo', async () => {
    const flightId = await createFlight({ capacityKg: '300' });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        api('POST', '/shipments', client.token, { description: 'Paralelo', weightKg: 100, flightId }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 3);
    assert.equal(results.filter((r) => r.code === 'INSUFFICIENT_CAPACITY').length, 3);
    assert.equal((await getFlight(flightId)).remainingCapacityKg, 0);
  });

  // ---------- Flujo completo ----------

  await test('flujo: asignar, reasignar, desasignar y asignar otra vez', async () => {
    const first = await createFlight();
    const second = await createFlight();
    const shipmentId = await createShipment();
    const versions = async () => [(await getFlight(first)).version, (await getFlight(second)).version];

    const assigned = await assign(shipmentId, first, 0, staffA.token);
    assertOk(assigned);
    assert.equal(assigned.body.id, shipmentId);
    assert.equal(assigned.body.events[0]?.type, 'ASSIGNED');
    assert.equal(assigned.body.events[0]?.airport?.iataCode, 'QZA');
    assert.deepEqual(await versions(), [1, 0]);

    const reassigned = await assign(shipmentId, second, 0, staffA.token);
    assertOk(reassigned);
    assert.equal(reassigned.body.events[0]?.type, 'REASSIGNED');
    assert.deepEqual(await versions(), [2, 1]);

    const removed = await unassign(shipmentId, staffA.token);
    assertOk(removed);
    assert.equal(removed.body.flight, null);
    assert.equal(removed.body.events[0]?.type, 'UNASSIGNED');
    assert.deepEqual(await versions(), [2, 2]);

    assertOk(await assign(shipmentId, first, 2, staffA.token));
    assert.deepEqual(await versions(), [3, 2]);

    assert.deepEqual(await eventTypes(shipmentId), ['ASSIGNED', 'REASSIGNED', 'UNASSIGNED', 'ASSIGNED']);
    const authors = await prisma.trackingEvent.findMany({ where: { shipmentId }, select: { createdById: true } });
    assert.ok(authors.every((e) => e.createdById === staffA.id), 'el autor del evento debe salir del token');
  });

  await test('flujo: la respuesta coincide con el GET público por código', async () => {
    const flightId = await createFlight();
    const assigned = await assign(await createShipment(), flightId, 0);
    const tracked = await api<ShipmentDetail>('GET', `/shipments/${assigned.body.trackingCode}`);
    assert.deepEqual(tracked.body, assigned.body);
  });

  await test('flujo: DELETE rechaza envíos sin vuelo, cargados o inexistentes', async () => {
    const flightId = await createFlight();
    assertError(await unassign(await createShipment()), 400, 'SHIPMENT_NOT_ASSIGNED');

    const loaded = await createShipment({ flightId, status: 'LOADED' });
    const before = await snapshot(loaded, [flightId]);
    assertError(await unassign(loaded), 400, 'SHIPMENT_NOT_ASSIGNABLE');
    assert.deepEqual(await snapshot(loaded, [flightId]), before);

    assertError(await unassign('00000000-0000-4000-8000-000000000000'), 404, 'SHIPMENT_NOT_FOUND');
    assertError(await api('DELETE', '/assignments/no-es-uuid', admin.token), 400, 'VALIDATION_ERROR');
  });

  // ---------- Concurrencia optimista ----------

  await test('versión: una versión desfasada da VERSION_CONFLICT y no cambia nada', async () => {
    const flightId = await createFlight();
    const shipmentId = await createShipment();
    assertOk(await assign(await createShipment(), flightId, 0));
    const before = await snapshot(shipmentId, [flightId]);

    assertError(await assign(shipmentId, flightId, 0), 409, 'VERSION_CONFLICT');
    assertError(await assign(shipmentId, flightId, 99), 409, 'VERSION_CONFLICT');
    assert.deepEqual(await snapshot(shipmentId, [flightId]), before);
    assert.deepEqual(await eventTypes(shipmentId), []);
  });

  await test('versión: tras un 409, recargar el vuelo y reintentar funciona', async () => {
    const flightId = await createFlight();
    const shipmentId = await createShipment();
    assertOk(await assign(await createShipment(), flightId, 0));
    assertError(await assign(shipmentId, flightId, 0), 409, 'VERSION_CONFLICT');
    assertOk(await assign(shipmentId, flightId, (await getFlight(flightId)).version));
  });

  await test('versión: un envío creado por un cliente desfasa la versión que tenía Staff', async () => {
    const flightId = await createFlight();
    const shipmentId = await createShipment();
    const stale = (await getFlight(flightId)).version;
    const created = await api('POST', '/shipments', client.token, { description: 'Cliente', weightKg: 1, flightId });
    assert.equal(created.status, 201);
    assertError(await assign(shipmentId, flightId, stale), 409, 'VERSION_CONFLICT');
  });

  await test('versión: con la misma versión en paralelo gana exactamente uno', async () => {
    const flightId = await createFlight();
    const shipments = await Promise.all(Array.from({ length: 8 }, () => createShipment({ weightKg: '5' })));
    const results = await Promise.all(shipments.map((id) => assign(id, flightId, 0)));

    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.code === 'VERSION_CONFLICT').length, 7);
    const flight = await getFlight(flightId);
    assert.deepEqual([flight.version, flight.assignedKg], [1, 5]);
  });

  await test('versión: el mismo envío movido en paralelo no duplica su peso', async () => {
    const first = await createFlight();
    const second = await createFlight();
    const shipmentId = await createShipment({ weightKg: '10' });
    const results = await Promise.all([assign(shipmentId, first, 0), assign(shipmentId, second, 0)]);

    assert.ok(results.some((r) => r.status === 200));
    assert.ok(results.every((r) => r.status !== 500));
    const total = (await getFlight(first)).assignedKg + (await getFlight(second)).assignedKg;
    assert.equal(total, 10);
  });

  await test('bloqueos: reasignaciones cruzadas A a B y B a A no se traban', async () => {
    const a = await createFlight();
    const b = await createFlight();
    const onA = await createShipment();
    const onB = await createShipment();
    for (let round = 0; round < 15; round++) {
      await prisma.shipment.update({ where: { id: onA }, data: { flightId: a } });
      await prisma.shipment.update({ where: { id: onB }, data: { flightId: b } });
      const [versionA, versionB] = [(await getFlight(a)).version, (await getFlight(b)).version];
      const results = await Promise.all([assign(onA, b, versionB), assign(onB, a, versionA)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], `ronda ${round}`);
    }
  });

  // ---------- Roles y reglas ----------

  await test('roles: sin token 401, CLIENT 403, STAFF y ADMIN pasan', async () => {
    const flightId = await createFlight();
    const shipmentId = await createShipment();
    assert.equal((await assign(shipmentId, flightId, 0, '')).status, 401);
    assert.equal((await assign(shipmentId, flightId, 0, client.token)).status, 403);
    assert.equal((await unassign(shipmentId, '')).status, 401);
    assert.equal((await unassign(shipmentId, client.token)).status, 403);
    assert.equal((await api('GET', '/flights', client.token)).status, 403);
    assert.equal((await api('GET', '/flights', staffA.token)).status, 200);
    assert.equal((await api('GET', '/flights', admin.token)).status, 200);
  });

  await test('aeropuerto: STAFF solo opera su aeropuerto y ADMIN cualquiera', async () => {
    const flightId = await createFlight();
    const shipmentId = await createShipment();
    const before = await snapshot(shipmentId, [flightId]);

    assertError(await assign(shipmentId, flightId, 0, staffB.token), 403, 'FORBIDDEN_AIRPORT');
    assertError(await assign(shipmentId, flightId, 0, staffNoAirport.token), 403, 'FORBIDDEN_AIRPORT');
    // El 403 va antes del 409 para no revelar datos de vuelos ajenos
    assertError(await assign(shipmentId, flightId, 99, staffB.token), 403, 'FORBIDDEN_AIRPORT');
    assert.deepEqual(await snapshot(shipmentId, [flightId]), before);

    assertOk(await assign(shipmentId, flightId, 0, admin.token));
    assertError(await unassign(shipmentId, staffB.token), 403, 'FORBIDDEN_AIRPORT');
    assertOk(await unassign(shipmentId, staffA.token));
  });

  await test('reglas: ruta, estado del vuelo, estado del envío y vuelo repetido', async () => {
    const flightId = await createFlight();
    const shipmentId = await createShipment();
    const otherOrigin = await createFlight({ originId: airportC, destinationId: airportB });
    const otherDestination = await createFlight({ originId: airportA, destinationId: airportC });
    const landed = await createFlight({ status: 'LANDED' });

    assertError(await assign(shipmentId, otherOrigin, 0), 400, 'ROUTE_MISMATCH');
    assertError(await assign(shipmentId, otherDestination, 0), 400, 'ROUTE_MISMATCH');
    assertError(await assign(shipmentId, landed, 0), 400, 'FLIGHT_NOT_AVAILABLE');

    const loaded = await createShipment({ status: 'LOADED' });
    assertError(await assign(loaded, flightId, 0), 400, 'SHIPMENT_NOT_ASSIGNABLE');

    assertOk(await assign(shipmentId, flightId, 0));
    assertError(await assign(shipmentId, flightId, 1), 400, 'ALREADY_ASSIGNED');
    // La ruta se conserva aunque el envío se quede sin vuelo
    assertOk(await unassign(shipmentId));
    assertError(await assign(shipmentId, otherDestination, 0), 400, 'ROUTE_MISMATCH');
  });

  await test('reglas: inexistentes dan 404 y un body inválido da 400', async () => {
    const flightId = await createFlight();
    const shipmentId = await createShipment();
    const missing = '00000000-0000-4000-8000-000000000000';
    assertError(await assign(missing, flightId, 0), 404, 'SHIPMENT_NOT_FOUND');
    assertError(await assign(shipmentId, missing, 0), 404, 'FLIGHT_NOT_FOUND');
    assertError(await assign(shipmentId, flightId, '0'), 400, 'VALIDATION_ERROR');
    assertError(await assign(shipmentId, flightId, -1), 400, 'VALIDATION_ERROR');
    assertError(await assign(shipmentId, flightId, undefined), 400, 'VALIDATION_ERROR');
    assertError(await assign('no-es-uuid', flightId, 0), 400, 'VALIDATION_ERROR');
  });
} finally {
  await cleanup();
  server.close();
  await prisma.$disconnect();
}

console.log(`\n${passed} pasaron, ${failures.length} fallaron`);
process.exitCode = failures.length > 0 ? 1 : 0;
