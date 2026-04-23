import request from 'supertest';
import express from 'express';
import { createApp } from '../app';
import { errorHandler } from '../errors/errorHandler';

describe('App Bootstrap', () => {
  let app: express.Application;

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
    const testApp = express();
    testApp.get('/test-error', (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const err = new Error('Test error');
      (err as any).status = 400;
      next(err);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test-error');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("code");
    expect(res.body).toHaveProperty("message", "Test error");
  });

  it('mounts wallet routes via createApp', async () => {
    const res = await request(app).get('/wallet/balance');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});

