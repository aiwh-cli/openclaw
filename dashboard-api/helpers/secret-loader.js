// ─── Secrets Helper ─────────────────────────────────────────
// Node.js wrapper around secrets.py — encrypted secret access.
// Caches loaded secrets in-memory with a 5-minute TTL.

const { execFileSync } = require('child_process');
const path = require('path');

const SECRETS_PY = path.join(__dirname, '../../scripts/lib/secrets.py');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let _cache = {};    // key → value
let _cacheTs = 0;   // last load timestamp
let _allLoaded = false;

function _isFresh() {
  return Date.now() - _cacheTs < CACHE_TTL;
}

/**
 * Load specific secrets by key name. Returns object { KEY: 'value', ... }.
 * Cached for 5 minutes.
 */
function loadSecrets(...keys) {
  // Return from cache if fresh
  const missing = keys.filter(k => !_cache[k] || !_isFresh());
  if (missing.length === 0 && _isFresh()) {
    const result = {};
    for (const k of keys) result[k] = _cache[k] || '';
    return result;
  }

  try {
    const out = execFileSync('python3', [SECRETS_PY, 'load', ...keys], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}` }
    });
    const result = {};
    for (const line of out.split('\n')) {
      const m = line.match(/^export\s+([A-Z_][A-Z0-9_]*)='(.*)'$/);
      if (m) {
        _cache[m[1]] = m[2];
        result[m[1]] = m[2];
      }
    }
    _cacheTs = Date.now();
    return result;
  } catch (e) {
    console.error('[secrets] Failed to load secrets:', e.message);
    // Return whatever we have cached, even if stale
    const result = {};
    for (const k of keys) result[k] = _cache[k] || '';
    return result;
  }
}

/**
 * Load all secrets. Returns object { KEY: 'value', ... }.
 */
function loadAll() {
  if (_allLoaded && _isFresh()) return { ..._cache };
  try {
    const out = execFileSync('python3', [SECRETS_PY, 'load', '--all'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}` }
    });
    const result = {};
    for (const line of out.split('\n')) {
      const m = line.match(/^export\s+([A-Z_][A-Z0-9_]*)='(.*)'$/);
      if (m) {
        _cache[m[1]] = m[2];
        result[m[1]] = m[2];
      }
    }
    _cacheTs = Date.now();
    _allLoaded = true;
    return result;
  } catch (e) {
    console.error('[secrets] Failed to load all secrets:', e.message);
    return { ..._cache };
  }
}

/**
 * Get a single secret value by key.
 */
function getSecret(key) {
  if (_cache[key] && _isFresh()) return _cache[key];
  const result = loadSecrets(key);
  return result[key] || '';
}

/**
 * Build env object for spawning scripts — loads all secrets into process.env clone.
 */
function buildScriptEnv() {
  const env = { ...process.env };
  const secrets = loadAll();
  Object.assign(env, secrets);
  return env;
}

/**
 * Clear the in-memory cache.
 */
function clearCache() {
  _cache = {};
  _cacheTs = 0;
  _allLoaded = false;
}

module.exports = { loadSecrets, loadAll, getSecret, buildScriptEnv, clearCache };
