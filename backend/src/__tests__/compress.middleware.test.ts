import { Request, Response, NextFunction } from 'express';
import zlib from 'zlib';
import { compressionMiddleware } from '../middleware/compress.middleware';

interface MockRes {
  _headers: Record<string, unknown>;
  _ended?: Buffer;
  _jsonCalled: boolean;
  setHeader: jest.Mock;
  removeHeader: jest.Mock;
  end: jest.Mock;
  json: (body: unknown) => MockRes;
}

function makeReq(acceptEncoding: string): Request {
  return {
    headers: { 'accept-encoding': acceptEncoding },
  } as unknown as Request;
}

function makeRes(): MockRes & Response {
  const _headers: Record<string, unknown> = {};
  const mock: MockRes = {
    _headers,
    _ended: undefined,
    _jsonCalled: false,
    setHeader: jest.fn((k: string, v: unknown) => { _headers[k] = v; }),
    removeHeader: jest.fn((k: string) => { delete _headers[k]; }),
    end: jest.fn((data: Buffer) => { mock._ended = data; }),
    json: jest.fn(function (this: MockRes, _body: unknown) {
      mock._jsonCalled = true;
      return this;
    }),
  };
  return mock as unknown as MockRes & Response;
}

const next: NextFunction = jest.fn();

beforeEach(() => jest.clearAllMocks());

const LARGE_BODY = { data: 'x'.repeat(2048) };
const SMALL_BODY = { ok: true };

describe('compressionMiddleware — brotli', () => {
  it('compresses with brotli when Accept-Encoding: br', () => {
    const req = makeReq('br');
    const res = makeRes();
    compressionMiddleware(req, res as unknown as Response, next);
    res.json(LARGE_BODY);

    expect(res._headers['Content-Encoding']).toBe('br');
    expect(res._headers['X-Compression']).toBe('brotli');
    const decoded = zlib.brotliDecompressSync(res._ended!);
    expect(JSON.parse(decoded.toString())).toEqual(LARGE_BODY);
  });
});

describe('compressionMiddleware — gzip', () => {
  it('compresses with gzip when Accept-Encoding: gzip', () => {
    const req = makeReq('gzip');
    const res = makeRes();
    compressionMiddleware(req, res as unknown as Response, next);
    res.json(LARGE_BODY);

    expect(res._headers['Content-Encoding']).toBe('gzip');
    expect(res._headers['X-Compression']).toBe('gzip');
    const decoded = zlib.gunzipSync(res._ended!);
    expect(JSON.parse(decoded.toString())).toEqual(LARGE_BODY);
  });

  it('prefers brotli over gzip when both are in Accept-Encoding', () => {
    const req = makeReq('gzip, br');
    const res = makeRes();
    compressionMiddleware(req, res as unknown as Response, next);
    res.json(LARGE_BODY);

    expect(res._headers['X-Compression']).toBe('brotli');
  });
});

describe('compressionMiddleware — identity (no compression)', () => {
  it('sets X-Compression: none and calls next when no Accept-Encoding', () => {
    const req = makeReq('');
    const res = makeRes();
    compressionMiddleware(req, res as unknown as Response, next);

    expect(res._headers['X-Compression']).toBe('none');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets X-Compression: none for unsupported encoding (deflate)', () => {
    const req = makeReq('deflate');
    const res = makeRes();
    compressionMiddleware(req, res as unknown as Response, next);

    expect(res._headers['X-Compression']).toBe('none');
  });
});

describe('compressionMiddleware — small response bypass', () => {
  it('does not compress responses smaller than 1 KB', () => {
    const req = makeReq('br, gzip');
    const res = makeRes();
    compressionMiddleware(req, res as unknown as Response, next);
    res.json(SMALL_BODY);

    expect(res._headers['X-Compression']).toBe('none');
    expect(res._jsonCalled).toBe(true);
    expect(res._ended).toBeUndefined();
  });
});
