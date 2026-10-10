import { lookupIp } from './ipGeo';

// ─── ipGeo.ts unit tests ──────────────────────────────────────────────────────

describe('lookupIp', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns null immediately for loopback IPv4', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const result = await lookupIp('127.0.0.1');
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null immediately for loopback IPv6 (::1)', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const result = await lookupIp('::1');
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null immediately for RFC-1918 10.x.x.x', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const result = await lookupIp('10.0.0.1');
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null immediately for RFC-1918 172.16.x.x', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const result = await lookupIp('172.16.5.5');
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null immediately for RFC-1918 192.168.x.x', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const result = await lookupIp('192.168.1.100');
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns parsed result for a successful response', async () => {
    const mockBody = {
      status: 'success',
      city: 'Manila',
      country: 'PH',
      lat: 14.5995,
      lon: 120.9842,
    };

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockBody,
    } as unknown as Response);

    const result = await lookupIp('1.2.3.4');
    expect(result).toEqual(mockBody);
  });

  it('returns null when ip-api returns status: fail', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'fail', message: 'reserved range', query: '1.2.3.4' }),
    } as unknown as Response);

    const result = await lookupIp('1.2.3.4');
    expect(result).toBeNull();
  });

  it('returns null on non-200 HTTP response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
    } as unknown as Response);

    const result = await lookupIp('1.2.3.4');
    expect(result).toBeNull();
  });

  it('returns null on timeout (fetch rejects with AbortError)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );

    const result = await lookupIp('1.2.3.4');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network request failed'));

    const result = await lookupIp('1.2.3.4');
    expect(result).toBeNull();
  });
});
