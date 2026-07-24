import { sleep, group } from 'k6';
import { throughputOptions } from './options.js';
import {
  authHeaders,
  createTrade,
  depositTrade,
  confirmDelivery,
  healthCheck,
  initiateDispute,
  listTrades,
  tradesCreated,
  tradesSettled,
} from './helpers.js';

export const options = throughputOptions;

function scenarioName() {
  return __ENV.SCENARIO || 'mixed';
}

export function createTrades() {
  const index = __ITER;
  const wallet = `G${__VU.toString().padStart(2, '0')}${Math.random().toString(36).slice(2, 10)}`;
  const headers = authHeaders(wallet);

  group('create trade', function () {
    const res = createTrade({ headers, index });
    if (res.status === 201) {
      tradesCreated.add(1);
      listTrades({ headers });
    }
  });

  sleep(Math.random() * 0.3 + 0.1);
}

export function settleTrades() {
  const wallet = `G${__VU.toString().padStart(2, '0')}${Math.random().toString(36).slice(2, 10)}`;
  const headers = authHeaders(wallet);
  const index = __ITER;

  group('settlement flow', function () {
    const createRes = createTrade({ headers, index });
    if (createRes.status === 201) {
      const tradeId = createRes.json('tradeId') || createRes.json('id') || `${__VU}-${__ITER}`;
      depositTrade({ headers, tradeId });
      confirmDelivery({ headers, tradeId });
      initiateDispute({ headers, tradeId, index });
      tradesSettled.add(1);
    }
  });

  healthCheck();
  sleep(Math.random() * 0.2 + 0.05);
}

export default function () {
  const name = scenarioName();
  if (name === 'creation') {
    createTrades();
  } else if (name === 'settlement') {
    settleTrades();
  } else {
    const choice = Math.random() < 0.6 ? 'creation' : 'settlement';
    if (choice === 'creation') {
      createTrades();
    } else {
      settleTrades();
    }
  }
}
