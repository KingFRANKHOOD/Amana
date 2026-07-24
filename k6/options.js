export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
export const STELLAR_RPC_URL = __ENV.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';

export const smokeOptions = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
  },
};

export const loadOptions = {
  stages: [
    { duration: '1m', target: 20 },
    { duration: '2m', target: 40 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2000'],
  },
};

export const stressOptions = {
  stages: [
    { duration: '30s', target: 25 },
    { duration: '1m', target: 75 },
    { duration: '1m', target: 150 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<4000'],
  },
};

export const soakOptions = {
  stages: [
    { duration: '5m', target: 10 },
    { duration: '15m', target: 10 },
    { duration: '5m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.03'],
    http_req_duration: ['p(95)<2500'],
  },
};

export const throughputOptions = {
  scenarios: {
    trade_creation: {
      executor: 'ramping-arrival-rate',
      startRate: 2,
      timeUnit: '1s',
      stages: [
        { target: 8, duration: '1m' },
        { target: 15, duration: '2m' },
        { target: 0, duration: '30s' },
      ],
      preAllocatedVUs: 20,
      maxVUs: 100,
      exec: 'createTrades',
    },
    settlement_flow: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 20,
      maxVUs: 150,
      exec: 'settleTrades',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2500'],
    trade_create_duration: ['p(95)<1800'],
    settlement_duration: ['p(95)<3000'],
  },
};
