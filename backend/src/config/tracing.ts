import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { env } from './env';

/**
 * OpenTelemetry configuration for distributed tracing
 * 
 * This sets up comprehensive observability including:
 * - Automatic instrumentation for Node.js modules
 * - Custom span creation for business logic
 * - Exporters for Jaeger, Zipkin, and Prometheus
 * - Service resource attributes for identification
 */

const service_name = 'amana-backend';
const service_version = process.env.npm_package_version || '1.0.0';

// Configure exporters based on environment
const exporters = [];

// Jaeger exporter (primary)
if (env.JAEGER_ENDPOINT || env.NODE_ENV === 'production') {
  const jaegerExporter = new JaegerExporter({
    endpoint: env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
  });
  exporters.push(jaegerExporter);
}

// Zipkin exporter (fallback)
if (env.ZIPKIN_ENDPOINT) {
  const zipkinExporter = new ZipkinExporter({
    url: env.ZIPKIN_ENDPOINT,
  });
  exporters.push(zipkinExporter);
}

// Prometheus metrics exporter
let prometheusExporter: PrometheusExporter | undefined;
if (env.PROMETHEUS_PORT || env.NODE_ENV === 'production') {
  prometheusExporter = new PrometheusExporter({
    port: Number(env.PROMETHEUS_PORT) || 9464,
    endpoint: '/metrics',
  });
  exporters.push(prometheusExporter);
}

// Initialize the OpenTelemetry SDK
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: service_name,
    [SemanticResourceAttributes.SERVICE_VERSION]: service_version,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV || 'development',
  }),
  traceExporter: exporters.length > 0 ? exporters[0] : undefined,
  metricReader: prometheusExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

// Initialize tracing
export function initializeTracing(): void {
  try {
    sdk.start();
    console.log('OpenTelemetry initialized successfully');
    
    if (prometheusExporter) {
      console.log(`Prometheus metrics available at http://localhost:${env.PROMETHEUS_PORT || 9464}/metrics`);
    }
  } catch (error) {
    console.error('Failed to initialize OpenTelemetry:', error);
  }
}

/**
 * Tracing utilities for creating custom spans
 */
export class TracingHelper {
  private static tracer = trace.getTracer(service_name, service_version);

  /**
   * Create a span for async operations
   */
  static async withSpan<T>(
    name: string,
    fn: (span: trace.Span) => Promise<T>,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, string | number | boolean>;
    }
  ): Promise<T> {
    const span = this.tracer.startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    });

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Create a span for synchronous operations
   */
  static withSyncSpan<T>(
    name: string,
    fn: (span: trace.Span) => T,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, string | number | boolean>;
    }
  ): T {
    const span = this.tracer.startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    });

    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Add attributes to the current active span
   */
  static setAttributes(attributes: Record<string, string | number | boolean>): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.setAttributes(attributes);
    }
  }

  /**
   * Add an event to the current active span
   */
  static addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.addEvent(name, attributes);
    }
  }

  /**
   * Record an exception on the current active span
   */
  static recordException(error: Error): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.recordException(error);
      activeSpan.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: error.message 
      });
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown().then(
    () => console.log('OpenTelemetry shut down successfully'),
    (err) => console.error('Error shutting down OpenTelemetry', err)
  );
});

process.on('SIGINT', () => {
  sdk.shutdown().then(
    () => console.log('OpenTelemetry shut down successfully'),
    (err) => console.error('Error shutting down OpenTelemetry', err)
  );
});
