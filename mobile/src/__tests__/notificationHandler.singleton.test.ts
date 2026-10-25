import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : collectSourceFiles(fullPath);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function filesCalling(pattern: RegExp): string[] {
  return collectSourceFiles(SRC_ROOT)
    .filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC_ROOT, file).split(path.sep).join('/'));
}

describe('notification wiring', () => {
  it('configures setNotificationHandler only in notification.service.ts', () => {
    expect(filesCalling(/\bsetNotificationHandler\s*\(/)).toEqual(['services/notification.service.ts']);
  });

  it('registers notification tap listeners only in notification.service.ts', () => {
    expect(filesCalling(/\baddNotificationResponseReceivedListener\s*\(/)).toEqual([
      'services/notification.service.ts',
    ]);
  });
});
