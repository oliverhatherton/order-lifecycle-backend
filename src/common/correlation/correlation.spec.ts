import { resolveCorrelationId } from '@/common/correlation/correlation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveCorrelationId', () => {
  it('adopts a non-empty string header', () => {
    expect(resolveCorrelationId('abc-123')).toBe('abc-123');
  });

  it('takes the first value of an array header', () => {
    expect(resolveCorrelationId(['first', 'second'])).toBe('first');
  });

  it('generates a UUID when the header is missing', () => {
    expect(resolveCorrelationId(undefined)).toMatch(UUID);
  });

  it('generates a UUID when the header is blank', () => {
    expect(resolveCorrelationId('   ')).toMatch(UUID);
  });
});
