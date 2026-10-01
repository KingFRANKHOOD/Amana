import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest';

describe('validateRequest', () => {
  const schema = z.object({
    body: z.object({
      amount: z.number().positive(),
      recipient: z.string().min(1),
    }),
  });

  function createRes() {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
  }

  it('passes valid requests through to next', () => {
    const req = {
      body: { amount: 10, recipient: 'alice' },
      query: {},
      params: {},
      originalUrl: '/api/trades',
    } as unknown as Request;
    const res = createRes();
    const next = jest.fn() as unknown as NextFunction;

    validateRequest(schema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns a structured error payload on validation failure', () => {
    const req = {
      body: { amount: -1, recipient: '' },
      query: {},
      params: {},
      originalUrl: '/api/trades',
    } as unknown as Request;
    const res = createRes();
    const next = jest.fn() as unknown as NextFunction;

    validateRequest(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);

    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload).toEqual(
      expect.objectContaining({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        path: '/api/trades',
      })
    );
    expect(typeof payload.timestamp).toBe('string');
    expect(new Date(payload.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('preserves all zod issues in details', () => {
    const req = {
      body: { amount: -1, recipient: '' },
      query: {},
      params: {},
      originalUrl: '/api/trades',
    } as unknown as Request;
    const res = createRes();
    const next = jest.fn() as unknown as NextFunction;

    validateRequest(schema)(req, res, next);

    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(Array.isArray(payload.details)).toBe(true);
    expect(payload.details).toHaveLength(2);
    expect(payload.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'body.amount' }),
        expect.objectContaining({ path: 'body.recipient' }),
      ])
    );
    payload.details.forEach((detail: { path: string; message: string; code: string }) => {
      expect(typeof detail.path).toBe('string');
      expect(typeof detail.message).toBe('string');
      expect(typeof detail.code).toBe('string');
    });
  });
});
