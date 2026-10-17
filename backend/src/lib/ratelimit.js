// In-memory fixed-window rate limiter. Good for a single server process.
// limiter(key) counts and checks in one step; limiter.check(key) only checks; limiter.hit(key) only counts.
import { HttpError } from './http.js';

export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  const entry = (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
    return h;
  };
  const check = (key) => {
    const h = entry(key);
    if (h.count >= max) {
      const err = new HttpError(429, message || 'Too many requests. Try again in a few minutes.');
      err.retryAfter = Math.ceil((h.reset - Date.now()) / 1000);
      throw err;
    }
  };
  const hit = (key) => { entry(key).count++; };
  const limiter = (key) => { check(key); hit(key); };
  limiter.check = check;
  limiter.hit = hit;
  return limiter;
}
