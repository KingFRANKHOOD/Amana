import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL } from './options.js';

export const errorRate = new Rate('errors');
export const tradeCreateTrend = new Trend('trade_create_duration');
export const tradeDepositTrend = new Trend('trade_deposit_duration');
export const tradeConfirmTrend = new Trend('trade_confirm_duration');
export const tradeDisputeTrend = new Trend('trade_dispute_duration');
export const tradeListTrend = new Trend('trade_list_duration');
export const settlementTrend = new Trend('settlement_duration');
export const tradesCreated = new Counter('trades_created');
export const tradesSettled = new Counter('trades_settled');

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const JWT_SECRET = __ENV.JWT_SECRET || 'k6-load-test-secret';

function base64UrlEncode(str) {
  return encoding.b64encode(str)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function hmacSha256Base64Url(secret, data) {
  const hash = crypto.hmac('sha256', data, secret, 'hex');
  const raw = [];
  for (let i = 0; i < hash.length; i += 2) {
    raw.push(parseInt(hash.substring(i, i + 2), 16));
  }
  const bytes = new Uint8Array(raw);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return base64UrlEncode(binary);
}

function readJsonValue(res, path) {
  try {
    return res.json(path);
  } catch (err) {
    return undefined;
  }
}

export function randomPublicKey() {
  let key = 'G';
  for (let i = 0; i < 55; i++) {
    key += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return key;
}

export function randomTradeId() {
  return `trade_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function generateJWT(walletAddress, overrideSecret) {
  const secret = overrideSecret || JWT_SECRET;
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    sub: walletAddress.toLowerCase(),
    walletAddress: walletAddress.toLowerCase(),
    jti: `k6-${__VU}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    iss: 'amana',
    aud: 'amana-api',
    iat: now,
    nbf: now,
    exp: now + 86400,
  }));
  const signature = hmacSha256Base64Url(secret, `${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

export function authHeaders(walletAddress) {
  return {
    Authorization: `Bearer ${generateJWT(walletAddress)}`,
    'Content-Type': 'application/json',
  };
}

export function stdChecks(res, expectedStatus = 200, extraChecks = {}) {
  const checks = {
    [`status ${expectedStatus}`]: (r) => r.status === expectedStatus,
    ...extraChecks,
  };
  return check(res, checks);
}

export function buildTradePayload(index) {
  const amounts = ['100.00', '250.50', '500.00', '1000.00', '2500.00', '5000.00'];
  const splits = [
    [5000, 5000],
    [3000, 7000],
    [7000, 3000],
    [2000, 8000],
    [8000, 2000],
  ];
  const [buyerLossBps, sellerLossBps] = splits[index % splits.length];
  return {
    sellerAddress: randomPublicKey(),
    amountUsdc: amounts[index % amounts.length],
    buyerLossBps,
    sellerLossBps,
  };
}

export function buildDisputePayload(index) {
  const reasons = [
    'Goods arrived late',
    'Quality was below expectation',
    'Documentation was incomplete',
  ];
  return {
    reason: reasons[index % reasons.length],
    category: 'delivery_issue',
  };
}

export function createTrade({ headers, index }) {
  const payload = JSON.stringify(buildTradePayload(index));
  const res = http.post(`${BASE_URL}/trades`, payload, { headers });
  const ok = stdChecks(res, 201, {
    'trade has tradeId': (r) => readJsonValue(r, 'tradeId') !== undefined,
    'trade has unsignedXdr': (r) => readJsonValue(r, 'unsignedXdr') !== undefined,
  });
  tradeCreateTrend.add(res.timings.duration);
  errorRate.add(!ok);
  return res;
}

export function listTrades({ headers }) {
  const res = http.get(`${BASE_URL}/trades?page=1&limit=10`, { headers });
  const ok = stdChecks(res, 200);
  tradeListTrend.add(res.timings.duration);
  errorRate.add(!ok);
  return res;
}

export function depositTrade({ headers, tradeId }) {
  const payload = JSON.stringify({});
  const res = http.post(`${BASE_URL}/trades/${tradeId}/deposit`, payload, { headers });
  const ok = stdChecks(res, 200, {
    'deposit has unsignedXdr': (r) => readJsonValue(r, 'unsignedXdr') !== undefined,
  });
  tradeDepositTrend.add(res.timings.duration);
  errorRate.add(!ok);
  return res;
}

export function confirmDelivery({ headers, tradeId }) {
  const payload = JSON.stringify({});
  const res = http.post(`${BASE_URL}/trades/${tradeId}/confirm`, payload, { headers });
  const ok = stdChecks(res, 200, {
    'confirm has unsignedXdr': (r) => readJsonValue(r, 'unsignedXdr') !== undefined,
  });
  tradeConfirmTrend.add(res.timings.duration);
  errorRate.add(!ok);
  return res;
}

export function initiateDispute({ headers, tradeId, index = 0 }) {
  const payload = JSON.stringify(buildDisputePayload(index));
  const res = http.post(`${BASE_URL}/trades/${tradeId}/dispute`, payload, { headers });
  const ok = stdChecks(res, 200, {
    'dispute has unsignedXdr': (r) => readJsonValue(r, 'unsignedXdr') !== undefined,
  });
  tradeDisputeTrend.add(res.timings.duration);
  errorRate.add(!ok);
  return res;
}

export function healthCheck() {
  const res = http.get(`${BASE_URL}/health`);
  stdChecks(res, 200);
  return res;
}