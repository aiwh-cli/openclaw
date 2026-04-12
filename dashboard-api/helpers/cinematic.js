// ─── Shared Cinematic Helpers ─────────────────────────────────
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Cinematic job ID validation
const CJOB_ID_RE = /^cjob_[a-zA-Z0-9_-]+$/;

// Prompt sanitization — strip control chars and injection patterns
function sanitizeForPrompt(text) {
  if (!text || typeof text !== 'string') return text || '';
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/`{3,}/g, '``')
    .replace(/^(SYSTEM|INSTRUCTION|IGNORE|OVERRIDE|FORGET|DISREGARD)\s*:/gmi, '[FILTERED]:')
    .replace(/\$\([^)]*\)/g, '[FILTERED]')
    .replace(/`[^`]*`/g, function(match) {
      if (match.length < 50 && !/\b(curl|wget|rm|cat|bash|sh|python|sqlite3|eval|exec)\b/i.test(match)) return match;
      return '[FILTERED]';
    });
}

// Spawn cinematic producer with logs to job directory
function spawnProducer(command, cjobId) {
  if (!CJOB_ID_RE.test(cjobId)) throw new Error('Invalid cinematic job ID');
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const logDir = path.join(CLIENT_ROOT, 'content', 'cinematic', cjobId);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'producer.log');
  const out = fs.openSync(logFile, 'a');
  const header = `\n=== ${new Date().toISOString()} | ${command} ${cjobId} ===\n`;
  fs.writeSync(out, header);
  const proc = spawn('python3', ['/opt/AIWH/core/scripts/cinematic-producer.py', command, cjobId], {
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', out, out],
    detached: true,
  });
  proc.unref();
  return proc;
}

module.exports = { CJOB_ID_RE, sanitizeForPrompt, spawnProducer };
