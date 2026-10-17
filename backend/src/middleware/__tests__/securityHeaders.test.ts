import request from 'supertest';
import express from 'express';
import securityHeaders from '../securityHeaders';

function buildApp() {
  const app = express();
  app.use(securityHeaders);
  app.get('/test', (_req, res) => res.send('ok'));
  return app;
}

describe('Security headers middleware', () => {
  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(buildApp()).get('/test');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY', async () => {
    const res = await request(buildApp()).get('/test');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets X-XSS-Protection in blocking mode', async () => {
    const res = await request(buildApp()).get('/test');
    expect(res.headers['x-xss-protection']).toBe('1; mode=block');
  });

  it('sets X-DNS-Prefetch-Control: off', async () => {
    const res = await request(buildApp()).get('/test');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
  });

  it('sets Referrer-Policy: strict-origin-when-cross-origin', async () => {
    const res = await request(buildApp()).get('/test');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets Content-Security-Policy header', async () => {
    const res = await request(buildApp()).get('/test');
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('sets Permissions-Policy header', async () => {
    const res = await request(buildApp()).get('/test');
    expect(res.headers['permissions-policy']).toBeDefined();
    expect(res.headers['permissions-policy']).toContain('geolocation=()');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['permissions-policy']).toContain('microphone=()');
  });

  it('sets X-Download-Options: noopen', async () => {
    const res = await request(buildApp()).get('/test');
    expect(res.headers['x-download-options']).toBe('noopen');
  });

  it('sets X-Permitted-Cross-Domain-Policies: none', async () => {
    const res = await request(buildApp()).get('/test');
    expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
  });

  it('removes X-Powered-By header', async () => {
    const res = await request(buildApp()).get('/test');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('applies headers across all response paths', async () => {
    const res = await request(buildApp()).get('/test');
    const expectedHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection',
      'x-dns-prefetch-control',
      'referrer-policy',
      'content-security-policy',
      'permissions-policy',
      'x-download-options',
      'x-permitted-cross-domain-policies',
    ];
    for (const header of expectedHeaders) {
      expect(res.headers[header]).toBeDefined();
    }
  });
});
