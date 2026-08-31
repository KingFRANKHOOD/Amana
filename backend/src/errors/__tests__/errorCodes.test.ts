import { ErrorCode, ERROR_STATUS_MAP } from '../errorCodes';
import { AppError, forbidden, unauthorized, notFound, validationError } from '../appError';

describe('ErrorCode enum', () => {
  it('exposes FORBIDDEN code', () => {
    expect(ErrorCode.FORBIDDEN).toBe('FORBIDDEN');
  });

  it('exposes UNAUTHORIZED code', () => {
    expect(ErrorCode.UNAUTHORIZED).toBe('UNAUTHORIZED');
  });

  it('maps FORBIDDEN to HTTP 403', () => {
    expect(ERROR_STATUS_MAP[ErrorCode.FORBIDDEN]).toBe(403);
  });

  it('maps UNAUTHORIZED to HTTP 401', () => {
    expect(ERROR_STATUS_MAP[ErrorCode.UNAUTHORIZED]).toBe(401);
  });

  it('maps AUTH_ERROR to HTTP 401 (legacy alias)', () => {
    expect(ERROR_STATUS_MAP[ErrorCode.AUTH_ERROR]).toBe(401);
  });
});

describe('AppError', () => {
  it('defaults to INTERNAL_ERROR / 500 when no code supplied', () => {
    const err = new AppError('boom');
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(err.statusCode).toBe(500);
  });

  it('derives statusCode from ERROR_STATUS_MAP for known codes', () => {
    const err = new AppError('nope', { code: ErrorCode.FORBIDDEN });
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('allows explicit statusCode override', () => {
    const err = new AppError('custom', {
      code: ErrorCode.INTERNAL_ERROR,
      statusCode: 502,
    });
    expect(err.statusCode).toBe(502);
  });

  it('serialises to a safe JSON payload', () => {
    const err = new AppError('denied', { code: ErrorCode.FORBIDDEN });
    const json = err.toJSON();
    expect(json.error.code).toBe('FORBIDDEN');
    expect(json.error.message).toBe('denied');
    expect(json.error.statusCode).toBe(403);
    expect(json.error.timestamp).toBeDefined();
  });

  it('attaches structured details when provided', () => {
    const details = [{ field: 'email', issue: 'required' }];
    const err = new AppError('bad input', {
      code: ErrorCode.VALIDATION_ERROR,
      details,
    });
    expect(err.details).toEqual(details);
  });
});

describe('Convenience helpers', () => {
  it('forbidden() returns FORBIDDEN / 403', () => {
    const err = forbidden();
    expect(err.code).toBe(ErrorCode.FORBIDDEN);
    expect(err.statusCode).toBe(403);
  });

  it('unauthorized() returns UNAUTHORIZED / 401', () => {
    const err = unauthorized();
    expect(err.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(err.statusCode).toBe(401);
  });

  it('notFound() returns NOT_FOUND / 404', () => {
    const err = notFound();
    expect(err.code).toBe(ErrorCode.NOT_FOUND);
    expect(err.statusCode).toBe(404);
  });

  it('validationError() returns VALIDATION_ERROR / 400 with details', () => {
    const err = validationError('bad', [{ field: 'name', issue: 'empty' }]);
    expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(err.statusCode).toBe(400);
    expect(err.details).toHaveLength(1);
  });
});
