import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.BASE_URL || 'http://localhost:3001';

export const options = {
  vus: 2,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
  },
};

export default function () {
  const response = http.get(`${baseUrl}/health/live`);
  check(response, {
    'health liveness endpoint returns 200': (result) => result.status === 200,
  });
}