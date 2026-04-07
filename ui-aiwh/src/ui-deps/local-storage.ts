/**
 * Safe localStorage accessor.
 * Original: openclaw/ui/src/ui/local-storage.ts (not found on disk, likely simple wrapper)
 * Browser localStorage can throw in private browsing or when storage is full.
 */

export function getSafeLocalStorage(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    // Quick write test to verify it's actually writable
    ls.setItem("__aiwh_test", "1");
    ls.removeItem("__aiwh_test");
    return ls;
  } catch {
    return null;
  }
}
