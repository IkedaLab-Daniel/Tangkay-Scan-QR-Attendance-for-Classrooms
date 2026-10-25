/**
 * Returns a persistent device fingerprint stored in localStorage.
 * Creates a new UUID on first call and caches it for all subsequent calls.
 */
export function getDeviceFingerprint(): string {
  if (typeof window === 'undefined') return '';
  const key = 'ts_device_fp';
  let fp = localStorage.getItem(key);
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem(key, fp);
  }
  return fp;
}
