// ─── IP Geolocation (fail-open) ───────────────────────────────────────────────

export interface IpGeoResult {
  city: string;
  country: string;
  lat: number;
  lon: number;
  status: 'success' | 'fail';
}

const PRIVATE_IP_RE = /^(127\.|::1$|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

/**
 * Looks up geolocation for a public IP via ip-api.com (free tier, no key).
 * Returns null for private IPs, on any network error, timeout, or non-success response.
 * Never throws.
 */
export async function lookupIp(ip: string): Promise<IpGeoResult | null> {
  if (PRIVATE_IP_RE.test(ip)) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);

    let res: Response;
    try {
      res = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,country,lat,lon`,
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return null;

    const data = (await res.json()) as IpGeoResult;
    if (data.status !== 'success') return null;

    return data;
  } catch {
    return null;
  }
}
