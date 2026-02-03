import http from 'k6/http';
import { check, sleep } from 'k6';

// Producción (Vercel)
const BASE_URL = __ENV.BASE_URL || 'https://sistema-rifas-2.vercel.app';

// Requerido para leer / escribir números del evento
const EVENT_ID = __ENV.EVENT_ID;

// Cédula base (para endpoints que exigen cedula). Puede ser cualquiera.
const CEDULA_SEED = __ENV.CEDULA_SEED || '1000000000';

// Rango y formato de números (depende del modo del evento/campaña)
const NUM_MIN = Number(__ENV.NUM_MIN || 0);
const NUM_MAX = Number(__ENV.NUM_MAX || 999);
const NUM_WIDTH = Number(__ENV.NUM_WIDTH || 3); // 2 => 0-99, 3 => 0-999, 4 => 0-9999

// Safe-by-default: no escribe nada en producción
const WRITE_MODE = String(__ENV.WRITE_MODE || '0') === '1';
const BUST_CACHE = String(__ENV.BUST_CACHE || '0') === '1';

// Write mode tuning
// Objetivo típico: 30 reservas/minuto => RES_RATE=30, RES_TIME_UNIT=1m, RES_DURATION=1m
const RES_RATE = Number(__ENV.RES_RATE || 30);
const RES_TIME_UNIT = String(__ENV.RES_TIME_UNIT || '1m');
const RES_DURATION = String(__ENV.RES_DURATION || '1m');
const RES_PREALLOCATED_VUS = Number(__ENV.RES_PREALLOCATED_VUS || 5);
const RES_MAX_VUS = Number(__ENV.RES_MAX_VUS || 20);
const NUMS_PER_RESERVA = Number(__ENV.NUMS_PER_RESERVA || 1);

// Burst mode: "N reservas simultáneas"
const RES_BURST = String(__ENV.RES_BURST || '0') === '1';
const RES_BURST_VUS = Number(__ENV.RES_BURST_VUS || 30);
const RES_BURST_START_DELAY_MS = Number(__ENV.RES_BURST_START_DELAY_MS || 3000);

function withCacheBust(url) {
  if (!BUST_CACHE) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_lt=${Date.now()}_${Math.random()}`;
}

function padNumber(n) {
  const s = String(n);
  if (s.length >= NUM_WIDTH) return s;
  return '0'.repeat(NUM_WIDTH - s.length) + s;
}

function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickUniqueNumbers(count) {
  const maxUnique = (NUM_MAX - NUM_MIN + 1);
  const target = Math.max(1, Math.min(count, maxUnique));
  const picked = new Set();
  while (picked.size < target) {
    picked.add(padNumber(randomIntBetween(NUM_MIN, NUM_MAX)));
  }
  return Array.from(picked);
}

function waitUntilEpochMs(ts) {
  if (!ts) return;
  while (Date.now() < ts) {
    sleep(0.05);
  }
}

function makeCedula(vu, iter) {
  // Solo dígitos (más compatible con tu schema y búsquedas)
  const base = Number(CEDULA_SEED) || 1000000000;
  const v = (vu * 100000) + iter;
  return String(base + (v % 800000000));
}

const scenarios = {
  read_flow: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: __ENV.STAGE_1 || '1m', target: Number(__ENV.VUS_1 || 10) },
      { duration: __ENV.STAGE_2 || '2m', target: Number(__ENV.VUS_2 || 30) },
      { duration: __ENV.STAGE_3 || '2m', target: Number(__ENV.VUS_3 || 60) },
      { duration: __ENV.STAGE_4 || '1m', target: 0 },
    ],
    gracefulRampDown: '30s',
    exec: 'readFlow',
  },
};

if (WRITE_MODE) {
  scenarios.reserve_flow = {
    ...(RES_BURST
      ? {
          // "N reservas simultáneas": N VUs hacen 1 reserva cada uno (sin sleep)
          executor: 'per-vu-iterations',
          vus: RES_BURST_VUS,
          iterations: 1,
          maxDuration: __ENV.RES_BURST_MAX_DURATION || '1m',
          exec: 'reserveFlow',
        }
      : {
          // Mantiene una tasa estable de reservas, ideal para: "30 reservas en 1 minuto"
          executor: 'constant-arrival-rate',
          rate: RES_RATE,
          timeUnit: RES_TIME_UNIT,
          duration: RES_DURATION,
          preAllocatedVUs: RES_PREALLOCATED_VUS,
          maxVUs: RES_MAX_VUS,
          exec: 'reserveFlow',
        }),
  };
}

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  },
};

export function setup() {
  if (!EVENT_ID) {
    throw new Error('Falta EVENT_ID. Ej: k6 run -e EVENT_ID=1 scripts/k6-eventos.js');
  }

  // Para burst realmente simultáneo: todos los VUs esperan hasta este timestamp.
  if (WRITE_MODE && RES_BURST) {
    return { burstStartEpochMs: Date.now() + RES_BURST_START_DELAY_MS };
  }
}

export function readFlow(data) {
  const cedula = makeCedula(__VU, __ITER);
  const numero = padNumber(randomIntBetween(NUM_MIN, NUM_MAX));

  // 1) Página principal (HTML). Esto valida performance del SSR/edge + headers.
  const pageRes = http.get(withCacheBust(`${BASE_URL}/usuario/eventos`), {
    redirects: 2,
    tags: { name: 'GET /usuario/eventos' },
  });
  check(pageRes, {
    'page 200': (r) => r.status === 200,
  });

  // 2) Números ocupados (lee DB + libera expirados)
  const occRes = http.get(withCacheBust(`${BASE_URL}/api/numeros-ocupados?eventId=${encodeURIComponent(EVENT_ID)}`), {
    tags: { name: 'GET /api/numeros-ocupados' },
  });
  check(occRes, {
    'ocupados 200': (r) => r.status === 200,
  });

  // 3) Check número (lee DB + libera expirados)
  const checkRes = http.get(
    withCacheBust(`${BASE_URL}/api/check-numero?eventId=${encodeURIComponent(EVENT_ID)}&numero=${encodeURIComponent(numero)}`),
    { tags: { name: 'GET /api/check-numero' } }
  );
  check(checkRes, {
    'check 200': (r) => r.status === 200,
  });

  // 4) Promo status (lee transacciones del usuario)
  const promoRes = http.get(
    withCacheBust(`${BASE_URL}/api/promo-status?eventId=${encodeURIComponent(EVENT_ID)}&cedula=${encodeURIComponent(cedula)}`),
    { tags: { name: 'GET /api/promo-status' } }
  );
  check(promoRes, {
    'promo 200/404 ok': (r) => r.status === 200 || r.status === 404,
  });

  // 5) Pending tx (endpoint pesado: finaliza promos, ledger, etc.)
  const pendingRes = http.get(
    withCacheBust(`${BASE_URL}/api/pending-transactions?cedula=${encodeURIComponent(cedula)}&eventId=${encodeURIComponent(EVENT_ID)}&view=welcome`),
    { tags: { name: 'GET /api/pending-transactions' } }
  );
  check(pendingRes, {
    'pending 200': (r) => r.status === 200,
  });

  // 6) Search usuario
  const userRes = http.get(withCacheBust(`${BASE_URL}/api/search-usuario?cedula=${encodeURIComponent(cedula)}`), {
    tags: { name: 'GET /api/search-usuario' },
  });
  check(userRes, {
    'search 200': (r) => r.status === 200,
  });

  sleep(Number(__ENV.SLEEP_SEC || 0.8));
}

export function reserveFlow(data) {
  if (!WRITE_MODE) {
    sleep(1);
    return;
  }

  if (RES_BURST) {
    waitUntilEpochMs(data && data.burstStartEpochMs);
  }

  const cedula = makeCedula(__VU, __ITER);
  const numeros = pickUniqueNumbers(NUMS_PER_RESERVA);

  // IMPORTANTE:
  // - Esto ESCRIBE en DB (Turso): reserva boletas.
  // - NO usa pago/abono (sin Cloudinary).
  // - Envía header x-load-test=1 para saltarse la cola de emails (ver patch).
  // - Úsalo SOLO con un EVENTO de PRUEBA en producción.

  const payload = {
    eventId: String(EVENT_ID),
    numeros,
    cedula,

    // Campos que el frontend manda (pero el server recalcula precios internamente)
    precioTotal: 0,
    precioNormal: 0,
    precioPromo: 0,
    precioNormalTotal: 0,
    precioPromoTotal: 0,
    promociones: 0,
    cantidadNormal: numeros.length,
    cantidadPromo: 0,
  };

  const res = http.post(`${BASE_URL}/api/reservar-numeros`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'x-load-test': '1',
    },
    tags: { name: 'POST /api/reservar-numeros (reserva)' },
  });

  // 200 ok, 409 conflicto (otro usuario lo tomó), 404 si número/evento no existe
  check(res, {
    'reserve 200/409/404 ok': (r) => [200, 409, 404].includes(r.status),
  });

  sleep(Number(__ENV.SLEEP_SEC_WRITE || 0));
}
