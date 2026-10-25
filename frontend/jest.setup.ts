// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = jest.fn(() => 'blob:mock');
}
if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = jest.fn();
}

if (typeof globalThis.TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic polyfill for jsdom
  const util = require('util');
  globalThis.TextEncoder = util.TextEncoder;
  globalThis.TextDecoder = util.TextDecoder;
}

// jsdom does not expose fetch/Request/Response/Headers/ReadableStream as globals.
// The Pact consumer suite runs under testEnvironment: 'node' (see jest.config.ts),
// where Node's native fetch is available, so only polyfill when missing.
if (typeof globalThis.fetch === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic polyfill for jsdom
  const { fetch, Request, Response, Headers, FormData } = require('undici');
  globalThis.fetch = fetch;
  globalThis.Request = Request;
  globalThis.Response = Response;
  globalThis.Headers = Headers;
  if (typeof globalThis.FormData === 'undefined') {
    globalThis.FormData = FormData;
  }
}

if (typeof globalThis.ReadableStream === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic polyfill for jsdom
  const { ReadableStream, WritableStream, TransformStream } = require('node:stream/web');
  globalThis.ReadableStream = ReadableStream;
  globalThis.WritableStream = WritableStream;
  globalThis.TransformStream = TransformStream;
}

import { configureAxe } from "jest-axe";
