import { Request, Response, NextFunction } from 'express';

jest.mock('../middleware/logger', () => ({
  appLogger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { appLogger } from '../middleware/logger';
import { sanitizeBody } from '../middleware/sanitize.middleware';

function makeReq(body: unknown): Request {
  return { body, path: '/test' } as Request;
}

const res = {} as Response;
const next: NextFunction = jest.fn();

beforeEach(() => jest.clearAllMocks());

describe('sanitizeBody — prototype pollution', () => {
  it('strips __proto__ key (via JSON.parse to create literal key)', () => {
    // JSON.parse is the standard way to produce an object with a real __proto__ key
    const body = JSON.parse('{"name":"ok","__proto__":{"evil":true}}');
    const req = makeReq(body);
    sanitizeBody()(req, res, next);
    expect(Object.keys(req.body)).not.toContain('__proto__');
    expect(req.body.name).toBe('ok');
  });

  it('strips constructor key', () => {
    const body = JSON.parse('{"x":1,"constructor":{"prototype":{}}}');
    const req = makeReq(body);
    sanitizeBody()(req, res, next);
    expect(Object.keys(req.body)).not.toContain('constructor');
  });

  it('strips prototype key', () => {
    const body = JSON.parse('{"a":"b","prototype":{}}');
    const req = makeReq(body);
    sanitizeBody()(req, res, next);
    expect(Object.keys(req.body)).not.toContain('prototype');
  });

  it('strips dangerous keys nested inside objects', () => {
    const body = JSON.parse('{"user":{"name":"alice","__proto__":{"admin":true}}}');
    const req = makeReq(body);
    sanitizeBody()(req, res, next);
    expect(Object.keys(req.body.user)).not.toContain('__proto__');
    expect(req.body.user.name).toBe('alice');
  });

  it('logs stripped dangerous keys at warn level', () => {
    const body = JSON.parse('{"__proto__":{"x":1},"ok":true}');
    const req = makeReq(body);
    sanitizeBody()(req, res, next);
    expect(appLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stripped: expect.arrayContaining(['__proto__']) }),
      expect.any(String),
    );
  });
});

describe('sanitizeBody — allowedFields', () => {
  it('passes through only allowed fields at top level', () => {
    const req = makeReq({ name: 'alice', secret: 'shh', age: 30 });
    sanitizeBody(['name', 'age'])(req, res, next);
    expect(req.body).toEqual({ name: 'alice', age: 30 });
    expect(req.body).not.toHaveProperty('secret');
  });

  it('logs stripped extra fields', () => {
    const req = makeReq({ allowed: 1, extra: 2 });
    sanitizeBody(['allowed'])(req, res, next);
    expect(appLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stripped: expect.arrayContaining(['extra']) }),
      expect.any(String),
    );
  });

  it('does not filter nested fields (allowedFields is top-level only)', () => {
    const req = makeReq({ user: { name: 'bob', role: 'admin' } });
    sanitizeBody(['user'])(req, res, next);
    expect(req.body.user.role).toBe('admin');
  });

  it('passes all fields through when no allowedFields provided', () => {
    const req = makeReq({ a: 1, b: 2, c: 3 });
    sanitizeBody()(req, res, next);
    expect(req.body).toEqual({ a: 1, b: 2, c: 3 });
    expect(appLogger.warn).not.toHaveBeenCalled();
  });
});

describe('sanitizeBody — edge cases', () => {
  it('skips processing when body is not an object', () => {
    const req = makeReq('raw string') as Request;
    sanitizeBody()(req, res, next);
    expect(req.body).toBe('raw string');
  });

  it('calls next in all cases', () => {
    const req = makeReq({ a: 1 });
    sanitizeBody()(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('strips dangerous keys inside arrays', () => {
    const body = JSON.parse('[{"name":"x","__proto__":{}}]');
    const req = makeReq({ items: body });
    sanitizeBody()(req, res, next);
    expect(Object.keys(req.body.items[0])).not.toContain('__proto__');
    expect(req.body.items[0].name).toBe('x');
  });
});
