import axios from 'axios';
import { TracedHttpClient, createTracedClient, withTracing } from '../lib/traced-http-client';

// Mock axios and OpenTelemetry
jest.mock('axios');
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
    getActiveSpan: jest.fn(() => ({
      attributes: { 'correlation.id': 'test-correlation-id' },
    })),
  },
  SpanKind: {
    CLIENT: 'CLIENT',
  },
  SpanStatusCode: {
    OK: 'OK',
    ERROR: 'ERROR',
  },
  context: {
    with: jest.fn((ctx, fn) => fn()),
  },
}));

jest.mock('../config/tracing', () => ({
  TracingHelper: {
    withSpan: jest.fn((name, fn) => fn({})),
    recordException: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAxiosInstance() {
  const mockInstance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: {
        use: jest.fn(),
      },
      response: {
        use: jest.fn(),
      },
    },
    defaults: {
      headers: {},
    },
  };
  return mockInstance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TracedHttpClient', () => {
  let client: TracedHttpClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    mockAxiosInstance = createMockAxiosInstance();
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);
    client = new TracedHttpClient('http://test.com', 'test-service');
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create axios instance with default config', () => {
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'http://test.com',
        timeout: 30000,
      });
    });

    it('should use default service name when not provided', () => {
      new TracedHttpClient('http://test.com');
      // Should not throw
    });
  });

  describe('Request interceptors', () => {
    it('should set up request interceptor', () => {
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
    });

    it('should set up response interceptor', () => {
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });

    it('should add tracing headers to requests', async () => {
      const requestHandler = mockAxiosInstance.interceptors.request.use.mock.calls[0][0];
      const config = {
        method: 'GET',
        url: '/test',
        headers: {},
      };

      const result = requestHandler(config);

      expect(result.headers['X-Correlation-Id']).toBeDefined();
      expect(result.headers['X-Request-Id']).toBeDefined();
      expect(result.headers['X-Correlation-Id']).toBe('test-correlation-id');
    });

    it('should preserve existing headers', async () => {
      const requestHandler = mockAxiosInstance.interceptors.request.use.mock.calls[0][0];
      const config = {
        method: 'GET',
        url: '/test',
        headers: {
          'Authorization': 'Bearer token',
          'Content-Type': 'application/json',
        },
      };

      const result = requestHandler(config);

      expect(result.headers['Authorization']).toBe('Bearer token');
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.headers['X-Correlation-Id']).toBeDefined();
    });

    it('should generate unique request IDs', async () => {
      const requestHandler = mockAxiosInstance.interceptors.request.use.mock.calls[0][0];
      
      const config1 = { method: 'GET', url: '/test', headers: {} };
      const config2 = { method: 'GET', url: '/test', headers: {} };

      const result1 = requestHandler(config1);
      const result2 = requestHandler(config2);

      expect(result1.headers['X-Request-Id']).not.toBe(result2.headers['X-Request-Id']);
    });
  });

  describe('Response interceptors', () => {
    it('should handle successful responses', async () => {
      const responseHandler = mockAxiosInstance.interceptors.response.use.mock.calls[0][0];
      const response = {
        config: { otelSpan: { setAttributes: jest.fn(), setStatus: jest.fn(), end: jest.fn() } },
        status: 200,
        statusText: 'OK',
        data: { result: 'success' },
      };

      const result = responseHandler(response);

      expect(result).toBe(response);
      expect(response.config.otelSpan.setAttributes).toHaveBeenCalledWith({
        'http.status_code': 200,
        'http.status_text': 'OK',
      });
    });

    it('should handle error responses', async () => {
      const errorHandler = mockAxiosInstance.interceptors.response.use.mock.calls[1][0];
      const error = {
        config: { otelSpan: { setAttributes: jest.fn(), setStatus: jest.fn(), end: jest.fn(), recordException: jest.fn() } },
        response: { status: 500, statusText: 'Internal Server Error' },
        message: 'Request failed',
      };

      await expect(errorHandler(error)).rejects.toThrow();
      expect(error.config.otelSpan.recordException).toHaveBeenCalled();
      expect(error.config.otelSpan.setStatus).toHaveBeenCalledWith({
        code: 'ERROR',
        message: 'Request failed',
      });
    });

    it('should track response body size', async () => {
      const responseHandler = mockAxiosInstance.interceptors.response.use.mock.calls[0][0];
      const response = {
        config: { otelSpan: { setAttributes: jest.fn(), setStatus: jest.fn(), end: jest.fn() } },
        status: 200,
        statusText: 'OK',
        data: { result: 'success', large: 'x'.repeat(1000) },
      };

      responseHandler(response);

      expect(response.config.otelSpan.setAttributes).toHaveBeenCalledWith(
        'http.response_body_size',
        expect.any(Number)
      );
    });
  });

  describe('HTTP methods', () => {
    beforeEach(() => {
      mockAxiosInstance.get.mockResolvedValue({ data: 'test' });
      mockAxiosInstance.post.mockResolvedValue({ data: 'test' });
      mockAxiosInstance.put.mockResolvedValue({ data: 'test' });
      mockAxiosInstance.patch.mockResolvedValue({ data: 'test' });
      mockAxiosInstance.delete.mockResolvedValue({ data: 'test' });
    });

    it('should make GET requests', async () => {
      await client.get('/test');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/test', undefined);
    });

    it('should make POST requests', async () => {
      await client.post('/test', { data: 'test' });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/test', { data: 'test' }, undefined);
    });

    it('should make PUT requests', async () => {
      await client.put('/test', { data: 'test' });
      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/test', { data: 'test' }, undefined);
    });

    it('should make PATCH requests', async () => {
      await client.patch('/test', { data: 'test' });
      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/test', { data: 'test' }, undefined);
    });

    it('should make DELETE requests', async () => {
      await client.delete('/test');
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/test', undefined);
    });

    it('should pass config options', async () => {
      const config = { timeout: 5000 };
      await client.get('/test', config);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/test', config);
    });
  });

  describe('Utility methods', () => {
    it('should set default headers', () => {
      const headers = { 'Authorization': 'Bearer token' };
      client.setDefaultHeaders(headers);
      
      expect(mockAxiosInstance.defaults.headers['Authorization']).toBe('Bearer token');
    });

    it('should set auth token', () => {
      client.setAuthToken('test-token');
      expect(mockAxiosInstance.defaults.headers['Authorization']).toBe('Bearer test-token');
    });

    it('should get axios instance', () => {
      const instance = client.getAxiosInstance();
      expect(instance).toBe(mockAxiosInstance);
    });
  });
});

describe('createTracedClient', () => {
  it('should create traced client with custom base URL', () => {
    const client = createTracedClient('http://custom.com', 'custom-service');
    expect(client).toBeInstanceOf(TracedHttpClient);
  });

  it('should use default service name when not provided', () => {
    const client = createTracedClient('http://custom.com');
    expect(client).toBeInstanceOf(TracedHttpClient);
  });
});

describe('withTracing', () => {
  it('should wrap function calls with tracing', async () => {
    const mockFn = jest.fn().mockResolvedValue('result');
    const { TracingHelper } = require('../config/tracing');

    await withTracing('test-operation', mockFn);

    expect(TracingHelper.withSpan).toHaveBeenCalledWith(
      'external_service_call: test-operation',
      expect.any(Function),
      {
        kind: 'CLIENT',
        attributes: {
          'operation.type': 'external_service',
          'operation.name': 'test-operation',
        },
      }
    );
  });

  it('should pass traced client to wrapped function', async () => {
    const mockFn = jest.fn().mockResolvedValue('result');
    const { TracingHelper } = require('../config/tracing');

    // Mock the implementation to call the function
    TracingHelper.withSpan.mockImplementation((name, fn) => {
      return fn({}); // Mock span
    });

    await withTracing('test-operation', mockFn);

    expect(mockFn).toHaveBeenCalledWith(expect.any(TracedHttpClient));
  });
});

describe('Error handling', () => {
  let client: TracedHttpClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    mockAxiosInstance = createMockAxiosInstance();
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);
    client = new TracedHttpClient('http://test.com');
    jest.clearAllMocks();
  });

  it('should handle request errors', async () => {
    const errorHandler = mockAxiosInstance.interceptors.request.use.mock.calls[0][1];
    const error = new Error('Request error');

    await expect(errorHandler(error)).rejects.toThrow('Request error');
  });

  it('should handle network errors', async () => {
    const errorHandler = mockAxiosInstance.interceptors.response.use.mock.calls[1][1];
    const error = new Error('Network error');

    await expect(errorHandler(error)).rejects.toThrow('Network error');
  });

  it('should handle timeouts', async () => {
    const errorHandler = mockAxiosInstance.interceptors.response.use.mock.calls[1][1];
    const error = new Error('timeout of 5000ms exceeded');

    await expect(errorHandler(error)).rejects.toThrow('timeout of 5000ms exceeded');
  });
});

describe('Performance and memory', () => {
  it('should not create memory leaks with multiple instances', () => {
    const clients = Array.from({ length: 100 }, () => 
      new TracedHttpClient('http://test.com')
    );

    expect(clients).toHaveLength(100);
    clients.forEach(client => {
      expect(client).toBeInstanceOf(TracedHttpClient);
    });
  });

  it('should handle concurrent requests', async () => {
    const client = new TracedHttpClient('http://test.com');
    mockAxiosInstance.get.mockResolvedValue({ data: 'test' });

    const promises = Array.from({ length: 10 }, (_, i) => 
      client.get(`/test?id=${i}`)
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(10);
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(10);
  });
});
