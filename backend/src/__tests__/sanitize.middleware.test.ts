import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { StrKey } from '@stellar/stellar-sdk';

jest.mock('../middleware/logger', () => ({
  appLogger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { appLogger } from '../middleware/logger';
import { sanitizeBody, sanitizeRequestInput } from '../middleware/sanitize.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { addNoteSchema } from '../schemas/trade.notes.schemas';

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

describe('sanitizeRequestInput — real request lifecycle', () => {
  it('does not HTML-escape ordinary strings or security-sensitive headers', () => {
    const req = {
      body: {
        message: '<script>alert(1)</script>',
        nested: { image: '<img src=x onerror=alert(1)>' },
      },
      query: {
        search: '<script>alert(1)</script>',
      },
      headers: {
        'user-agent': '<script>alert(1)</script>',
        authorization: 'Bearer token-value',
        'x-webhook-signature': 'sha256=abc123',
        'content-type': 'application/json',
      },
      path: '/trades/abc',
    } as unknown as Request;

    sanitizeRequestInput()(req, res, next);

    expect(req.body.message).toBe('<script>alert(1)</script>');
    expect(req.body.nested.image).toBe('<img src=x onerror=alert(1)>');
    expect(req.query.search).toBe('<script>alert(1)</script>');
    expect(req.headers['user-agent']).toBe('<script>alert(1)</script>');
    expect(req.headers.authorization).toBe('Bearer token-value');
    expect(req.headers['x-webhook-signature']).toBe('sha256=abc123');
    expect(req.headers['content-type']).toBe('application/json');
  });

  it('keeps route path validation responsible for params, not the global middleware', async () => {
    const app = express();
    app.use(express.json());
    app.use(sanitizeRequestInput());

    app.get(
      '/trades/:id',
      validateRequest({
        params: z.object({
          id: z.string().regex(/^[A-Za-z0-9_-]+$/, 'Trade ID contains unsupported characters'),
        }),
      }),
      (req, res) => {
        res.status(200).json({ id: req.params.id });
      },
    );

    const rejected = await request(app).get('/trades/%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({
      error: expect.stringMatching(/^id:/),
    });

    const accepted = await request(app).get('/trades/trade_123');
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ id: 'trade_123' });
  });

  it('rejects script payloads in free-form note text while allowing legitimate notes', async () => {
    const app = express();
    app.use(express.json());

    app.post(
      '/trades/:id/notes',
      validateRequest({
        params: z.object({ id: z.string().min(1) }),
        body: addNoteSchema,
      }),
      (_req, res) => res.status(201).json({ ok: true }),
    );

    const blocked = await request(app)
      .post('/trades/t-123/notes')
      .send({ content: '<script>alert(1)</script>' });

    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/content/i);

    const allowed = await request(app)
      .post('/trades/t-123/notes')
      .send({ content: 'Shipment arrived on time.' });

    expect(allowed.status).toBe(201);
    expect(allowed.body).toEqual({ ok: true });
  });

  it('rejects non-wallet path values before public profile handlers run', async () => {
    const app = express();
    app.use(express.json());

    app.get(
      '/users/:address',
      validateRequest({
        params: z.object({
          address: z.string().refine((value: string) => StrKey.isValidEd25519PublicKey(value), {
            message: 'Invalid Stellar public key',
          }),
        }),
      }),
      (_req, res) => res.status(200).json({ ok: true }),
    );

    const blocked = await request(app).get('/users/%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/address/i);

    const validKey = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(1));
    const allowed = await request(app).get(`/users/${validKey}`);
    expect(allowed.status).toBe(200);
  });
});
