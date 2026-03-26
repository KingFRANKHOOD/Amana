import request from 'supertest';
import { createApp } from '../app';

describe('App Bootstrap', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  it('should return 200 on /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'amana-backend',
    });
    expect(res.body.timestamp).toBeDefined();
  });

  it('should handle errors with structured JSON', async () => {
    app.get('/test-error', (req, res) => {
      const err = new Error('Test error');
      (err as any).status = 400;
      throw err;
    });

    const res = await request(app).get('/test-error');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', true);
    expect(res.body).toHaveProperty('status', 400);
    expect(res.body).toHaveProperty('message', 'Test error');
  });
});

