import type { DOMSnapshot, SnapshotCacheEntry } from '../types';

const TTL_MS = 4000;
const MUT_THROTTLE_MS = 250;
const MUT_ATTR = 'flowmindMutCount';

let observerStarted = false;
let mutCount = 0;
let lastBump = 0;
let entry: SnapshotCacheEntry | null = null;

function ensureObserver(): void {
  if (observerStarted) return;
  if (typeof document === 'undefined' || !document.body) return;
  observerStarted = true;
  const obs = new MutationObserver(() => {
    const now = Date.now();
    if (now - lastBump < MUT_THROTTLE_MS) return;
    lastBump = now;
    mutCount = (mutCount + 1) >>> 0;
    document.body.dataset[MUT_ATTR] = String(mutCount);
  });
  try {
    obs.observe(document.body, { childList: true, subtree: true });
    document.body.dataset[MUT_ATTR] = String(mutCount);
  } catch {
    /* ignore */
  }
}

function currentKey(): string {
  if (typeof document === 'undefined') return '0|0|0';
  ensureObserver();
  const url = location.href;
  const scrollBucket = Math.round((window.scrollY || 0) / 100);
  return `${url}|${scrollBucket}|${mutCount}`;
}

/**
 * Returns a cached DOM snapshot for the current page if the URL, scroll
 * position bucket, and mutation counter all match a recent capture.
 * Callers should fall back to `analyzeDom()` on miss.
 */
export function getCachedSnapshot(): DOMSnapshot | null {
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    entry = null;
    return null;
  }
  if (entry.key !== currentKey()) {
    entry = null;
    return null;
  }
  return entry.snapshot;
}

export function putCachedSnapshot(snapshot: DOMSnapshot): void {
  entry = { key: currentKey(), snapshot, ts: Date.now() };
}

export function invalidateSnapshotCache(): void {
  entry = null;
}
