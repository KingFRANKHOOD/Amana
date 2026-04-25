import React, { useState, useCallback, useRef } from 'react';
import { tracedHttpClient, TracedResponse, TracedRequestOptions } from '../lib/traced-fetch';

/**
 * React hook for making traced HTTP requests
 * 
 * Features:
 * - Loading state management
 * - Error handling
 * - Automatic correlation ID propagation
 * - Request cancellation on unmount
 * - Retry functionality
 */

export interface UseTracedFetchOptions extends TracedRequestOptions {
  retryCount?: number;
  retryDelay?: number;
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
}

export interface TracedFetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  correlationId: string | null;
  requestId: string | null;
  lastResponse: TracedResponse<T> | null;
}

/**
 * Hook for making traced HTTP requests with state management
 */
export function useTracedFetch<T = any>(defaultOptions: UseTracedFetchOptions = {}) {
  const [state, setState] = useState<TracedFetchState<T>>({
    data: null,
    loading: false,
    error: null,
    correlationId: null,
    requestId: null,
    lastResponse: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Cleanup on unmount
  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    mountedRef.current = false;
  }, []);

  // Update state safely (only if component is mounted)
  const updateState = useCallback((updates: Partial<TracedFetchState<T>>) => {
    if (mountedRef.current) {
      setState(prev => ({ ...prev, ...updates }));
    }
  }, []);

  // Execute HTTP request with retry logic
  const executeRequest = useCallback(async (
    requestFn: () => Promise<TracedResponse<T>>,
    options: UseTracedFetchOptions = {}
  ): Promise<TracedResponse<T>> => {
    const { retryCount = 0, retryDelay = 1000 } = options;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const response = await requestFn();
        return response;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < retryCount) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError;
  }, []);

  // Generic request method
  const request = useCallback(async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options: UseTracedFetchOptions = {}
  ): Promise<T> => {
    // Cancel previous request if still running
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();
    
    const requestOptions: TracedRequestOptions = {
      ...defaultOptions,
      ...options,
      signal: abortControllerRef.current.signal,
    };

    updateState({
      loading: true,
      error: null,
    });

    try {
      let response: TracedResponse<T>;

      switch (method) {
        case 'GET':
          response = await tracedHttpClient.get<T>(url, requestOptions);
          break;
        case 'POST':
          response = await tracedHttpClient.post<T>(url, options.body, requestOptions);
          break;
        case 'PUT':
          response = await tracedHttpClient.put<T>(url, options.body, requestOptions);
          break;
        case 'PATCH':
          response = await tracedHttpClient.patch<T>(url, options.body, requestOptions);
          break;
        case 'DELETE':
          response = await tracedHttpClient.delete<T>(url, requestOptions);
          break;
        default:
          throw new Error(`Unsupported method: ${method}`);
      }

      // Add retry logic if specified
      const finalResponse = await executeRequest(
        () => Promise.resolve(response),
        requestOptions
      );

      updateState({
        data: finalResponse.data || null,
        loading: false,
        error: null,
        correlationId: finalResponse.correlationId || null,
        requestId: finalResponse.requestId || null,
        lastResponse: finalResponse,
      });

      // Call success callback if provided
      if (defaultOptions.onSuccess && finalResponse.data) {
        defaultOptions.onSuccess(finalResponse.data);
      }
      if (options.onSuccess && finalResponse.data) {
        options.onSuccess(finalResponse.data);
      }

      return finalResponse.data as T;
    } catch (error) {
      const err = error as Error;
      
      updateState({
        loading: false,
        error: err,
      });

      // Call error callback if provided
      if (defaultOptions.onError) {
        defaultOptions.onError(err);
      }
      if (options.onError) {
        options.onError(err);
      }

      throw err;
    }
  }, [defaultOptions, executeRequest, updateState]);

  // Convenience methods
  const get = useCallback((url: string, options: UseTracedFetchOptions = {}) => {
    return request('GET', url, options);
  }, [request]);

  const post = useCallback((url: string, data?: any, options: UseTracedFetchOptions = {}) => {
    return request('POST', url, { ...options, body: data });
  }, [request]);

  const put = useCallback((url: string, data?: any, options: UseTracedFetchOptions = {}) => {
    return request('PUT', url, { ...options, body: data });
  }, [request]);

  const patch = useCallback((url: string, data?: any, options: UseTracedFetchOptions = {}) => {
    return request('PATCH', url, { ...options, body: data });
  }, [request]);

  const del = useCallback((url: string, options: UseTracedFetchOptions = {}) => {
    return request('DELETE', url, options);
  }, [request]);

  // Reset state
  const reset = useCallback(() => {
    updateState({
      data: null,
      loading: false,
      error: null,
      correlationId: null,
      requestId: null,
      lastResponse: null,
    });
  }, [updateState]);

  // Set correlation ID for next request
  const setCorrelationId = useCallback((correlationId: string) => {
    updateState({ correlationId });
  }, [updateState]);

  return {
    ...state,
    get,
    post,
    put,
    patch,
    delete: del,
    reset,
    setCorrelationId,
    cleanup,
  };
}

/**
 * Hook for making traced GET requests (simplified)
 */
export function useTracedGet<T = any>(url: string | null, options: UseTracedFetchOptions = {}) {
  const { data, loading, error, correlationId, requestId, get } = useTracedFetch<T>(options);

  // Auto-fetch when URL changes
  React.useEffect(() => {
    if (url) {
      get(url, options).catch(() => {
        // Error is handled by the hook
      });
    }
  }, [url, get, options]);

  return { data, loading, error, correlationId, requestId, refetch: () => url && get(url, options) };
}

/**
 * Hook for making traced mutations (POST, PUT, PATCH, DELETE)
 */
export function useTracedMutation<T = any>(options: UseTracedFetchOptions = {}) {
  const { data, loading, error, correlationId, requestId, post, put, patch, delete: del } = useTracedFetch<T>(options);

  const mutate = useCallback(async (
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    data?: any
  ) => {
    switch (method) {
      case 'POST':
        return post(url, data, options);
      case 'PUT':
        return put(url, data, options);
      case 'PATCH':
        return patch(url, data, options);
      case 'DELETE':
        return del(url, options);
      default:
        throw new Error(`Unsupported mutation method: ${method}`);
    }
  }, [post, put, patch, del, options]);

  return {
    data,
    loading,
    error,
    correlationId,
    requestId,
    mutate,
    post: (url: string, data?: any) => post(url, data, options),
    put: (url: string, data?: any) => put(url, data, options),
    patch: (url: string, data?: any) => patch(url, data, options),
    delete: (url: string) => del(url, options),
  };
}
