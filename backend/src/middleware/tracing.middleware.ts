import { trace, SpanKind, SpanStatusCode, context } from '@opentelemetry/api';
import { NextFunction, Request, Response } from 'express';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER, TracedRequest } from './correlationId.middleware';
import { TracingHelper } from '../config/tracing';

/**
 * OpenTelemetry middleware that creates spans for HTTP requests
 * and integrates with the existing correlation ID system.
 * 
 * This middleware:
 * - Creates spans for all HTTP requests
 * - Links correlation IDs with trace spans
 * - Adds request/response attributes to spans
 * - Handles error recording for spans
 */
export function tracingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const tracer = trace.getTracer('amana-backend');
  const tracedReq = req as TracedRequest;
  
  // Extract route information if available (Express sets this after routing)
  const route = (req as any).route?.path || req.path || req.url;
  
  const span = tracer.startSpan(`${req.method} ${route}`, {
    kind: SpanKind.SERVER,
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
      'http.target': req.url,
      'http.scheme': req.protocol,
      'http.host': req.get('host') || '',
      'http.user_agent': req.get('user-agent') || '',
      'http.remote_addr': req.ip || req.connection.remoteAddress || '',
      'net.host.name': req.hostname,
      'correlation.id': tracedReq.correlationId,
      'request.id': tracedReq.requestId,
    },
  });

  // Set the span on the request for access in controllers/services
  (req as any).otelSpan = span;

  // Add correlation ID to span for cross-service tracing
  span.setAttributes({
    'correlation.id': tracedReq.correlationId,
    'request.id': tracedReq.requestId,
  });

  // Create context with span for downstream operations
  const ctx = trace.setSpan(context.active(), span);
  
  // Store original end method to intercept response completion
  const originalEnd = res.end;
  res.end = function(this: Response, ...args: any[]) {
    // Add response attributes to span
    span.setAttributes({
      'http.status_code': res.statusCode,
      'http.status_text': res.statusMessage || '',
    });

    // Set span status based on HTTP status code
    if (res.statusCode >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${res.statusCode}: ${res.statusMessage || 'Error'}`,
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    // Add response headers that might be useful for tracing
    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(res.getHeaders())) {
      if (typeof value === 'string') {
        responseHeaders[key.toLowerCase()] = value;
      }
    }
    
    span.setAttributes({
      'http.response_headers': JSON.stringify(responseHeaders),
    });

    // End the span
    span.end();

    // Call original end
    originalEnd.apply(this, args);
  };

  // Store original res.json method to intercept JSON responses
  const originalJson = res.json;
  res.json = function(this: Response, ...args: any[]) {
    // Add response body size for monitoring (only if reasonable size)
    if (args[0] && typeof args[0] === 'object') {
      try {
        const bodySize = JSON.stringify(args[0]).length;
        span.setAttribute('http.response_body_size', bodySize);
      } catch (error) {
        // Ignore serialization errors
      }
    }
    return originalJson.apply(this, args);
  };

  // Handle request errors
  res.on('error', (error: Error) => {
    TracingHelper.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `Response error: ${error.message}`,
    });
  });

  // Execute the request in the tracing context
  context.with(ctx, () => {
    next();
  });
}

/**
 * Utility to get the current span from the request
 */
export function getRequestSpan(req: Request): trace.Span | undefined {
  return (req as any).otelSpan;
}

/**
 * Utility to add custom attributes to the current request span
 */
export function addRequestSpanAttribute(req: Request, key: string, value: string | number | boolean): void {
  const span = getRequestSpan(req);
  if (span) {
    span.setAttribute(key, value);
  }
}

/**
 * Utility to add events to the current request span
 */
export function addRequestSpanEvent(req: Request, name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = getRequestSpan(req);
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Middleware to add business logic tracing
 */
export function businessLogicTracing(operationName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const span = getRequestSpan(req);
    if (span) {
      span.addEvent(`business_logic_start`, { operation: operationName });
      
      // Store original end to mark business logic completion
      const originalEnd = res.end;
      res.end = function(this: Response, ...args: any[]) {
        span.addEvent(`business_logic_end`, { operation: operationName });
        originalEnd.apply(this, args);
      };
    }
    next();
  };
}
