import { Request, Response, NextFunction } from 'express';
import zlib from 'zlib';

const MIN_COMPRESS_BYTES = 1024;

type Encoding = 'br' | 'gzip' | 'identity';

function pickEncoding(acceptEncoding: string): Encoding {
  if (/\bbr\b/.test(acceptEncoding)) return 'br';
  if (/\bgzip\b/.test(acceptEncoding)) return 'gzip';
  return 'identity';
}

export function compressionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const acceptEncoding = String(req.headers['accept-encoding'] ?? '');
  const encoding = pickEncoding(acceptEncoding);

  if (encoding === 'identity') {
    res.setHeader('X-Compression', 'none');
    return next();
  }

  const originalJson = res.json.bind(res);

  res.json = function compressedJson(body: unknown): Response {
    const raw = Buffer.from(JSON.stringify(body));

    if (raw.length < MIN_COMPRESS_BYTES) {
      res.setHeader('X-Compression', 'none');
      return originalJson(body);
    }

    let compressed: Buffer;
    try {
      compressed =
        encoding === 'br' ? zlib.brotliCompressSync(raw) : zlib.gzipSync(raw);
    } catch {
      res.setHeader('X-Compression', 'none');
      return originalJson(body);
    }

    res.setHeader('Content-Encoding', encoding === 'br' ? 'br' : 'gzip');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Compression', encoding === 'br' ? 'brotli' : 'gzip');
    res.removeHeader('Content-Length');
    res.end(compressed);
    return res;
  };

  next();
}
