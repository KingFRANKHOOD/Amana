import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { loadOptions, STELLAR_RPC_URL } from './options.js';

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 15 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.02'],
  },
};

const stellarErrorRate = new Rate('stellar_errors');
const rpcCallTrend = new Trend('stellar_rpc_duration');

function randomPublicKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let key = 'G';
  for (let i = 0; i < 55; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function generateContractCallXdr(operation, tradeId) {
  const fakeSource = randomPublicKey();
  return btoa(JSON.stringify({
    op: operation,
    tradeId,
    source: fakeSource,
    ts: Date.now(),
    nonce: Math.floor(Math.random() * 1e9),
  }));
}

export default function () {
  group('Stellar RPC Simulation', function () {
    group('Get Account', function () {
      const address = randomPublicKey();
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: __VU * 1000 + __ITER,
        method: 'getAccount',
        params: [address],
      });

      const res = http.post(STELLAR_RPC_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      const isOk = check(res, {
        'rpc response received': (r) => r.status === 200 || r.status === 404,
      });
      rpcCallTrend.add(res.timings.duration);
      stellarErrorRate.add(!isOk);
    });

    sleep(0.5);

    group('Simulate Transaction', function () {
      const xdr = generateContractCallXdr('create_trade', Math.floor(Math.random() * 1e9));
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: __VU * 1000 + __ITER,
        method: 'simulateTransaction',
        params: [{ transaction: xdr }],
      });

      const res = http.post(STELLAR_RPC_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      check(res, {
        'simulate tx response received': (r) => r.status === 200 || r.status === 400,
      });
      rpcCallTrend.add(res.timings.duration);
    });

    sleep(0.5);

    group('Send Transaction (simulated)', function () {
      const xdr = generateContractCallXdr('deposit', Math.floor(Math.random() * 1e6));
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: __VU * 1000 + __ITER,
        method: 'sendTransaction',
        params: [{ transaction: xdr }],
      });

      const res = http.post(STELLAR_RPC_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      check(res, {
        'send tx response received': (r) => r.status === 200 || r.status === 400,
      });
      rpcCallTrend.add(res.timings.duration);
    });

    sleep(0.5);

    group('Get Transaction Status', function () {
      const txHash = Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: __VU * 1000 + __ITER,
        method: 'getTransaction',
        params: [{ hash: txHash }],
      });

      const res = http.post(STELLAR_RPC_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      check(res, {
        'tx status response received': (r) => r.status === 200 || r.status === 404,
      });
      rpcCallTrend.add(res.timings.duration);
    });

    sleep(0.5);

    group('Stellar Fees Backend', function () {
      const payload = JSON.stringify({
        sourceAddress: randomPublicKey(),
        operationCount: 2,
      });

      const res = http.post(`${__ENV.BASE_URL || 'http://localhost:3001'}/stellar/fees`, payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      check(res, {
        'fees response received': (r) => r.status === 200 || r.status === 500,
      });
      rpcCallTrend.add(res.timings.duration);
    });
  });

  sleep(1);
}
