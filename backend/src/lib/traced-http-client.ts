import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { trace, SpanKind, SpanStatusCode, context } from '@opentelemetry/api';
import { TracingHelper } from '../config/tracing';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '../middleware/correlationId.middleware';

/**
 * Traced HTTP client that automatically propagates correlation IDs
 * and creates OpenTelemetry spans for external service calls.
 * 
 * Features:
 * - Automatic correlation ID propagation
 * - OpenTelemetry span creation for HTTP calls
 * - Error handling and span status management
 * - Request/response timing and size tracking
 */
export class TracedHttpClient {
  private axiosInstance: AxiosInstance;
  private serviceName: string;

  constructor(baseURL?: string, serviceName = 'amana-backend') {
    this.serviceName = serviceName;
    this.axiosInstance = axios.create({
      baseURL,
      timeout: 30000, // 30 seconds default timeout
    });

    // Request interceptor to add tracing headers and create spans
    this.axiosInstance.interceptors.request.use(
      (config) => {
        const tracer = trace.getTracer(this.serviceName);
        const span = tracer.startSpan(`HTTP ${config.method?.toUpperCase()} ${config.url}`, {
          kind: SpanKind.CLIENT,
          attributes: {
            'http.method': config.method?.toUpperCase(),
            'http.url': config.url,
            'net.peer.name': (() => { try { return new URL(config.baseURL || config.url || '').hostname; } catch { return ''; } })(),
            'correlation.service': this.serviceName,
          },
        });

        // Get current correlation ID from active span or context
        const activeSpan = trace.getActiveSpan();
        const correlationId = (activeSpan as any)?.attributes?.['correlation.id'] as string | undefined;
        
        if (correlationId) {
          config.headers[CORRELATION_ID_HEADER] = correlationId;
        }

        // Add request ID for this specific call
        config.headers[REQUEST_ID_HEADER] = crypto.randomUUID();

        // Store span on config for response interceptor
        (config as any).otelSpan = span;

        // Add request metadata to span
        if (config.data) {
          try {
            const dataSize = JSON.stringify(config.data).length;
            span.setAttribute('http.request_body_size', dataSize);
          } catch (error) {
            // Ignore serialization errors
          }
        }

        return config;
      },
      (error) => {
        TracingHelper.recordException(error);
        return Promise.reject(error);
      }
    );

    // Response interceptor to complete spans
    this.axiosInstance.interceptors.response.use(
      (response) => {
        const span = (response.config as any).otelSpan;
        if (span) {
          span.setAttributes({
            'http.status_code': response.status,
            'http.status_text': response.statusText,
          });

          if (response.data) {
            try {
              const responseSize = JSON.stringify(response.data).length;
              span.setAttribute('http.response_body_size', responseSize);
            } catch (error) {
              // Ignore serialization errors
            }
          }

          if (response.status >= 400) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `HTTP ${response.status}: ${response.statusText}`,
            });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }

          span.end();
        }

        return response;
      },
      (error) => {
        const span = error.config?.otelSpan;
        if (span) {
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message || 'HTTP request failed',
          });

          if (error.response) {
            span.setAttributes({
              'http.status_code': error.response.status,
              'http.status_text': error.response.statusText,
            });
          }

          span.end();
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Make a GET request with tracing
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.get(url, config);
  }

  /**
   * Make a POST request with tracing
   */
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.post(url, data, config);
  }

  /**
   * Make a PUT request with tracing
   */
  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.put(url, data, config);
  }

  /**
   * Make a DELETE request with tracing
   */
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.delete(url, config);
  }

  /**
   * Make a PATCH request with tracing
   */
  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.patch(url, data, config);
  }

  /**
   * Set default headers for all requests
   */
  setDefaultHeaders(headers: Record<string, string>): void {
    Object.assign(this.axiosInstance.defaults.headers, headers);
  }

  /**
   * Set authorization header
   */
  setAuthToken(token: string): void {
    this.axiosInstance.defaults.headers['Authorization'] = `Bearer ${token}`;
  }

  /**
   * Get the underlying axios instance for advanced use cases
   */
  getAxiosInstance(): AxiosInstance {
    return this.axiosInstance;
  }
}

/**
 * Default traced HTTP client instance (lazy singleton)
 */
let _tracedHttpClient: TracedHttpClient | undefined;
export function getTracedHttpClient(): TracedHttpClient {
  if (!_tracedHttpClient) {
    _tracedHttpClient = new TracedHttpClient();
  }
  return _tracedHttpClient;
}
// Keep backward-compatible export — resolved lazily on first property access
export { getTracedHttpClient as tracedHttpClient };

/**
 * Create a traced HTTP client for a specific service
 */
export function createTracedClient(baseURL: string, serviceName?: string): TracedHttpClient {
  return new TracedHttpClient(baseURL, serviceName);
}

/**
 * Utility function to wrap existing axios calls with tracing
 */
export function withTracing<T>(
  operationName: string,
  fn: (client: TracedHttpClient) => Promise<T>
): Promise<T> {
  return TracingHelper.withSpan(
    `external_service_call: ${operationName}`,
    async (span) => {
      span.setAttribute('operation.name', operationName);
      return fn(getTracedHttpClient());
    },
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'operation.type': 'external_service',
        'operation.name': operationName,
      },
    }
  );
}
