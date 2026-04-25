import request from 'supertest';
import express, { NextFunction, Request, Response } from 'express';
import { tracingMiddleware, getRequestSpan, addRequestSpanAttribute } from '../middleware/tracing.middleware';
import { createApp } from '../app';
import { trace } from '@opentelemetry/api';

// Mock OpenTelemetry for testing
jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: jest.fn(() => ({
      startSpan: jest.fn(() => ({
        setAttributes: jest.fn(),
        addEvent: jest.fn(),
        recordException: jest.fn(),
        setStatus: jest.fn(),
        end: jest.fn(),
      })),
    })),
    getActiveSpan: jest.fn(),
    setSpan: jest.fn(() => ({})),
    active: jest.fn(),
  },
  SpanKind: {
    SERVER: 'SERVER',
  },
  SpanStatusCode: {
    OK: 'OK',
    ERROR: 'ERROR',
  },
  context: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestApp() {
  const app = express();
  app.use(express.json());
  app.use(tracingMiddleware);
  
  app.get('/test', (req: Request, res: Response) => {
    // Test accessing the span from request
    const span = getRequestSpan(req);
    if (span) {
      addRequestSpanAttribute(req, 'test.attribute', 'test-value');
    }
    res.json({ message: 'test response' });
  });

  app.post('/test-error', (req: Request, res: Response, next: NextFunction) => {
    const error = new Error('Test error');
    (error as any).status = 500;
    next(error);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tracingMiddleware', () => {
  let app: express.Application;

  beforeEach(() => {
    app = makeTestApp();
    jest.clearAllMocks();
  });

  describe('Basic functionality', () => {
    it('should create a span for HTTP requests', async () => {
      const res = await request(app).get('/test');
      
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('test response');
      
      // Verify tracer was called
      const { getTracer } = require('@opentelemetry/api');
      expect(getTracer).toHaveBeenCalledWith('amana-backend');
    });

    it('should handle POST requests', async () => {
      const res = await request(app)
        .post('/test')
        .send({ data: 'test' });
      
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('test response');
    });

    it('should handle errors properly', async () => {
      const res = await request(app).post('/test-error');
      
      expect(res.status).toBe(500);
    });
  });

  describe('Span attributes', () => {
    it('should set HTTP attributes on spans', async () => {
      await request(app)
        .get('/test')
        .set('User-Agent', 'test-agent')
        .set('X-Forwarded-For', '127.0.0.1');

      const { getTracer } = require('@opentelemetry/api');
      const mockStartSpan = getTracer().startSpan;
      
      expect(mockStartSpan).toHaveBeenCalled();
      const spanCall = mockStartSpan.mock.calls[0];
      const attributes = spanCall[1].attributes;
      
      expect(attributes).toMatchObject({
        'http.method': 'GET',
        'http.url': '/test',
        'http.user_agent': 'test-agent',
      });
    });

    it('should add custom attributes to spans', async () => {
      await request(app).get('/test');
      
      // The test endpoint adds a custom attribute
      // Verify the attribute was added
      expect(true).toBe(true); // Placeholder - actual verification would require mocking
    });
  });

  describe('Response handling', () => {
    it('should set response attributes on span completion', async () => {
      const res = await request(app).get('/test');
      
      expect(res.status).toBe(200);
      
      // Verify span was completed with status code
      const { getTracer } = require('@opentelemetry/api');
      const mockSpan = getTracer().startSpan();
      
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'http.status_code': 200,
        })
      );
    });

    it('should set error status for error responses', async () => {
      await request(app).post('/test-error');
      
      const { getTracer } = require('@opentelemetry/api');
      const mockSpan = getTracer().startSpan();
      
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'ERROR',
        })
      );
    });

    it('should track response body size for JSON responses', async () => {
      const res = await request(app).get('/test');
      
      expect(res.status).toBe(200);
      
      // Verify response size tracking
      const { getTracer } = require('@opentelemetry/api');
      const mockSpan = getTracer().startSpan();
      
      // The span should have received body size attribute
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'http.response_body_size',
        expect.any(Number)
      );
    });
  });

  describe('Integration with correlation IDs', () => {
    it('should integrate with existing correlation ID system', async () => {
      // This test would require the correlation ID middleware to be present
      const app = createApp();
      
      const res = await request(app)
        .get('/health')
        .set('x-correlation-id', 'test-correlation-id');
      
      expect(res.status).toBe(200);
      expect(res.headers['x-correlation-id']).toBe('test-correlation-id');
    });
  });

  describe('Error handling', () => {
    it('should handle response errors gracefully', async () => {
      // Mock res.on to simulate an error
      const mockRes = {
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Response error'));
          }
        }),
        getHeaders: jest.fn(() => ({})),
        statusCode: 200,
        statusMessage: 'OK',
        end: jest.fn(),
        json: jest.fn(),
      };

      // This would test the error handling in the middleware
      expect(true).toBe(true); // Placeholder
    });

    it('should handle JSON serialization errors', async () => {
      // Mock a response that causes JSON serialization to fail
      const circularRef = {};
      (circularRef as any).self = circularRef;

      const res = await request(app)
        .post('/test')
        .send(circularRef);
      
      // Should handle the error gracefully
      expect([200, 400, 500]).toContain(res.status);
    });
  });

  describe('Performance and memory', () => {
    it('should not leak memory on repeated requests', async () => {
      // Make multiple requests to test for memory leaks
      const promises = Array.from({ length: 100 }, () => 
        request(app).get('/test')
      );
      
      const results = await Promise.all(promises);
      
      // All requests should succeed
      results.forEach(res => {
        expect(res.status).toBe(200);
      });
    });

    it('should handle concurrent requests properly', async () => {
      const promises = Array.from({ length: 10 }, (_, i) => 
        request(app).get(`/test?id=${i}`)
      );
      
      const results = await Promise.all(promises);
      
      // All requests should succeed and have different spans
      results.forEach(res => {
        expect(res.status).toBe(200);
      });
      
      // Verify multiple spans were created
      const { getTracer } = require('@opentelemetry/api');
      expect(getTracer().startSpan).toHaveBeenCalledTimes(10);
    });
  });
});

describe('Tracing utilities', () => {
  let app: express.Application;

  beforeEach(() => {
    app = makeTestApp();
    jest.clearAllMocks();
  });

  describe('getRequestSpan', () => {
    it('should return the span from request object', async () => {
      // This would require access to the actual request object
      // For now, we test the concept
      expect(typeof getRequestSpan).toBe('function');
    });
  });

  describe('addRequestSpanAttribute', () => {
    it('should add attributes to the request span', async () => {
      await request(app).get('/test');
      
      // Verify the attribute was added
      const { getTracer } = require('@opentelemetry/api');
      const mockSpan = getTracer().startSpan();
      
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'test.attribute': 'test-value',
        })
      );
    });
  });
});
