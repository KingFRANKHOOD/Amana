import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { loadOptions, BASE_URL } from './options.js';

export const options = loadOptions;

const tradeCreateTrend = new Trend('trade_create_duration');
const tradeListTrend = new Trend('trade_list_duration');
const depositTrend = new Trend('trade_deposit_duration');
const confirmTrend = new Trend('trade_confirm_duration');
const disputeTrend = new Trend('trade_dispute_duration');
const errorRate = new Rate('errors');
const tradesCreated = new Counter('trades_created');

const JWT_SECRET = 'k6-load-test-secret';
const WALLET_SECRET = 'SBLZBX6U3J7H5Y6KZ5T2H5Q6F3L7Z8X9';

function randomPublicKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let key = 'G';
  for (let i = 0; i < 55; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function generateToken(walletAddress) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    walletAddress,
    jti: `k6-${__VU}-${Date.now()}`,
    iss: 'amana',
    aud: 'amana-api',
    iat: now,
    exp: now + 3600,
  }));
  const signature = btoa(`fake-sig-${walletAddress}`);
  return `${header}.${payload}.${signature}`;
}

export default function () {
  const buyerWallet = randomPublicKey();
  const sellerWallet = randomPublicKey();
  const token = generateToken(buyerWallet);
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  group('Trade Lifecycle', function () {
    group('Create Trade', function () {
      const payload = JSON.stringify({
        sellerAddress: sellerWallet,
        amountUsdc: '100.00',
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      const res = http.post(`${BASE_URL}/trades`, payload, { headers });
      const isOk = check(res, {
        'create trade status 201': (r) => r.status === 201,
        'create trade has tradeId': (r) => r.json('tradeId') !== undefined,
        'create trade has unsignedXdr': (r) => r.json('unsignedXdr') !== undefined,
      });
      tradeCreateTrend.add(res.timings.duration);
      errorRate.add(!isOk);
      if (isOk) tradesCreated.add(1);
    });

    sleep(1);

    group('List Trades', function () {
      const res = http.get(`${BASE_URL}/trades?page=1&limit=10`, { headers });
      const isOk = check(res, {
        'list trades status 200': (r) => r.status === 200,
      });
      tradeListTrend.add(res.timings.duration);
      errorRate.add(!isOk);
    });

    sleep(1);

    group('Deposit', function () {
      const payload = JSON.stringify({});
      const res = http.post(`${BASE_URL}/trades/4294967297/deposit`, payload, { headers });
      const isOk = check(res, {
        'deposit status 200': (r) => r.status === 200,
        'deposit has unsignedXdr': (r) => r.json('unsignedXdr') !== undefined,
      });
      depositTrend.add(res.timings.duration);
      errorRate.add(!isOk);
    });

    sleep(1);

    group('Confirm Delivery', function () {
      const payload = JSON.stringify({});
      const res = http.post(`${BASE_URL}/trades/4294967297/confirm`, payload, { headers });
      const isOk = check(res, {
        'confirm delivery status 200': (r) => r.status === 200,
        'confirm delivery has unsignedXdr': (r) => r.json('unsignedXdr') !== undefined,
      });
      confirmTrend.add(res.timings.duration);
      errorRate.add(!isOk);
    });

    sleep(1);

    group('Initiate Dispute', function () {
      const payload = JSON.stringify({
        reason: 'Goods not delivered on time',
        category: 'delivery_issue',
      });
      const res = http.post(`${BASE_URL}/trades/4294967297/dispute`, payload, { headers });
      const isOk = check(res, {
        'dispute status 200': (r) => r.status === 200,
        'dispute has unsignedXdr': (r) => r.json('unsignedXdr') !== undefined,
      });
      disputeTrend.add(res.timings.duration);
      errorRate.add(!isOk);
    });
  });

  group('Health Check', function () {
    const res = http.get(`${BASE_URL}/health`);
    check(res, {
      'health status 200': (r) => r.status === 200,
    });
  });

  sleep(2);
}
