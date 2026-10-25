import { tracedHttpClient } from '../traced-fetch';

describe('TracedHttpClient', () => {
  it('preserves the native response and its readable body', async () => {
    const nativeResponse = new Response(JSON.stringify({ message: 'created' }), {
      status: 201,
      headers: { 'content-type': 'application/json', 'x-result': 'ok' },
    });
    global.fetch = jest.fn().mockResolvedValue(nativeResponse);

    const response = await tracedHttpClient.get<{ message: string }>('/resource', {
      correlationId: 'test-correlation-id',
    });

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(201);
    expect(response.ok).toBe(true);
    expect(response.headers.get('x-result')).toBe('ok');
    expect(response.data).toEqual({ message: 'created' });
    await expect(response.json()).resolves.toEqual({ message: 'created' });
  });
});