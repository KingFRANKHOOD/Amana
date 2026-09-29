import { readFileSync } from 'fs';
import { join } from 'path';
import { AMOUNT_USDC_PATTERN, computeTradeAmount } from '../amount';

describe('computeTradeAmount', () => {
  it.each([
    ['1.1', '3.001'],
    ['0.1', '0.2'],
    ['3', '0.1'],
    ['123.4567891', '9.87654321'],
  ])('produces a backend-valid amount for %s x %s', (qty, price) => {
    const amount = computeTradeAmount(qty, price);
    expect(amount).toMatch(AMOUNT_USDC_PATTERN);
    expect(Number(amount)).toBeCloseTo(parseFloat(qty) * parseFloat(price), 6);
  });

  it('rounds float noise away', () => {
    expect(computeTradeAmount('0.1', '0.2')).toBe('0.02');
    expect(computeTradeAmount('1.1', '3.001')).toBe('3.3011');
    expect(computeTradeAmount('10', '5')).toBe('50');
  });

  it.each([
    ['', '5'],
    ['abc', '5'],
    ['0', '5'],
    ['-2', '5'],
    ['1e200', '1e200'],
  ])('returns "0" for invalid input %s x %s', (qty, price) => {
    expect(computeTradeAmount(qty, price)).toBe('0');
  });
});

describe('amountUsdc contract with backend', () => {
  it('mobile pattern matches backend createTradeSchema.amountUsdc regex', () => {
    const schemaSrc = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'backend', 'src', 'schemas', 'trade.schemas.ts'),
      'utf8',
    );
    const match = schemaSrc.match(/amountUsdc:[\s\S]*?\.regex\(\/(.+?)\/,/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(AMOUNT_USDC_PATTERN.source);
  });
});
