export const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function required(condition, message = 'Invalid provider response') { if (!condition) throw new Error(message); }
export function rating(value) {
  if (value == null) return null;
  required(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);
  return value;
}
export function count(value) {
  if (value == null) return null;
  required(Number.isSafeInteger(value) && value >= 0);
  return value;
}
export function date(value) {
  if (value == null) return null;
  required(typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)));
  return new Date(value).toISOString();
}
export function providerURL(value, host) {
  required(typeof value === 'string');
  const url = new URL(value);
  required(url.protocol === 'https:' && url.hostname === host && !url.username && !url.password && !url.port);
  return url.href;
}
export function name(value) { required(typeof value === 'string' && value.trim().length > 0 && value.length <= 500); return value; }
export const numericId = value => typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value);
