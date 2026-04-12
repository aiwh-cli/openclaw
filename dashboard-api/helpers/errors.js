// ─── Error Response Sanitizer ────────────────────────────────
// Strips internal filesystem paths from error messages sent to clients.
// Applied as Express middleware — intercepts res.json() calls.

const INTERNAL_PATH_RE = /\/opt\/AIWH\/[^\s)'"`,]+/g;
const HOMEBREW_PATH_RE = /\/opt\/homebrew\/[^\s)'"`,]+/g;
const USERS_PATH_RE = /\/Users\/[^\s)'"`,]+/g;

function sanitizeMessage(msg) {
  if (typeof msg !== 'string') return msg;
  return msg
    .replace(INTERNAL_PATH_RE, '[internal]')
    .replace(HOMEBREW_PATH_RE, '[internal]')
    .replace(USERS_PATH_RE, '[internal]');
}

/**
 * Express middleware that intercepts res.json() to sanitize error fields.
 * Only sanitizes when status >= 400 and response has an `error` field.
 */
function errorSanitizer(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 400 && body && typeof body.error === 'string') {
      body = { ...body, error: sanitizeMessage(body.error) };
    }
    return originalJson(body);
  };
  next();
}

module.exports = { errorSanitizer, sanitizeMessage };
