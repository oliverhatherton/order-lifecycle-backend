import { buildCorsOrigins } from '@/common/cors/cors-origin';

/** Does the allow-list admit this origin (string equality or regex match)? */
function allows(origins: (string | RegExp)[], origin: string): boolean {
  return origins.some((o) =>
    typeof o === 'string' ? o === origin : o.test(origin),
  );
}

describe('buildCorsOrigins', () => {
  it('keeps a plain origin as an exact string match', () => {
    const origins = buildCorsOrigins(
      'https://order-lifecycle-demo.oliverhatherton.com',
    );

    expect(origins).toEqual([
      'https://order-lifecycle-demo.oliverhatherton.com',
    ]);
    expect(
      allows(origins, 'https://order-lifecycle-demo.oliverhatherton.com'),
    ).toBe(true);
    expect(allows(origins, 'https://other.oliverhatherton.com')).toBe(false);
  });

  it('splits and trims a comma-separated list', () => {
    const origins = buildCorsOrigins(
      'https://a.oliverhatherton.com , http://localhost:5173',
    );

    expect(allows(origins, 'https://a.oliverhatherton.com')).toBe(true);
    expect(allows(origins, 'http://localhost:5173')).toBe(true);
  });

  describe('subdomain wildcard (https://*.oliverhatherton.com)', () => {
    const origins = buildCorsOrigins('https://*.oliverhatherton.com');

    it('allows a direct subdomain and nested subdomains', () => {
      expect(
        allows(origins, 'https://order-lifecycle-demo.oliverhatherton.com'),
      ).toBe(true);
      expect(allows(origins, 'https://a.b.oliverhatherton.com')).toBe(true);
    });

    it('rejects the apex domain (no subdomain label)', () => {
      expect(allows(origins, 'https://oliverhatherton.com')).toBe(false);
    });

    it('rejects look-alike and suffix-trick domains', () => {
      expect(allows(origins, 'https://eviloliverhatherton.com')).toBe(false);
      expect(allows(origins, 'https://demo.oliverhatherton.com.evil.com')).toBe(
        false,
      );
      expect(allows(origins, 'https://oliverhatherton.evil.com')).toBe(false);
    });

    it('rejects a non-https scheme', () => {
      expect(allows(origins, 'http://demo.oliverhatherton.com')).toBe(false);
    });
  });
});
