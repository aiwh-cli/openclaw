// ─── Log Streamer ─────────────────────────────────────────────
// Tails log files and pushes new lines via Socket.io.
// Supports live streaming to the Logs view.

const fs = require('fs');
const path = require('path');

const LOGS_DIR = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/logs';
const OPENCLAW_LOGS = '/opt/AIWH/.openclaw/logs';

const KNOWN_LOGS = [
  { id: 'cost-monitor',         label: 'Cost Monitor',         path: path.join(LOGS_DIR, 'cost-monitor.log') },
  { id: 'knowledge-pipeline',   label: 'Knowledge Pipeline',   path: path.join(LOGS_DIR, 'knowledge-pipeline.log') },
  { id: 'cinematic-costs',      label: 'Cinematic Costs',      path: path.join(LOGS_DIR, 'cinematic-costs.jsonl') },
  { id: 'video-voice',          label: 'Video Voice',          path: path.join(LOGS_DIR, 'video-voice-agent.log') },
  { id: 'video-avatar',         label: 'Video Avatar',         path: path.join(LOGS_DIR, 'video-avatar-agent.log') },
  { id: 'video-caption',        label: 'Video Caption',        path: path.join(LOGS_DIR, 'video-caption-agent.log') },
  { id: 'video-qa',             label: 'Video QA',             path: path.join(LOGS_DIR, 'video-qa-agent.log') },
  { id: 'video-publisher',      label: 'Video Publisher',      path: path.join(LOGS_DIR, 'video-publisher-agent.log') },
  { id: 'batch-embed',          label: 'Batch Embedding',      path: path.join(LOGS_DIR, 'batch-embed.log') },
  { id: 'dashboard',            label: 'Dashboard',            path: path.join(LOGS_DIR, 'dashboard.log') },
  { id: 'gateway',              label: 'OpenClaw Gateway',     path: path.join(OPENCLAW_LOGS, 'gateway.log') },
  { id: 'gateway-errors',       label: 'Gateway Errors',       path: path.join(OPENCLAW_LOGS, 'gateway.err.log') },
];

/**
 * List all known log files with their existence status and size.
 */
function listLogs() {
  return KNOWN_LOGS.map(l => {
    let size = 0;
    let exists = false;
    let lastModified = null;
    try {
      const stat = fs.statSync(l.path);
      size = stat.size;
      exists = true;
      lastModified = stat.mtime.toISOString();
    } catch {}
    return { ...l, exists, size, lastModified };
  });
}

/**
 * Read the last N lines from a log file.
 */
function tailLog(logId, lines = 200) {
  const log = KNOWN_LOGS.find(l => l.id === logId);
  if (!log) return { error: 'Unknown log', lines: [] };
  if (!fs.existsSync(log.path)) return { error: 'Log file not found', lines: [] };

  try {
    const content = fs.readFileSync(log.path, 'utf8');
    const allLines = content.split('\n').filter(Boolean);
    return {
      id: logId,
      label: log.label,
      path: log.path,
      totalLines: allLines.length,
      lines: allLines.slice(-lines),
    };
  } catch (e) {
    return { error: e.message, lines: [] };
  }
}

/**
 * Watch a log file and call onLine for each new line appended.
 * Returns a stop() function to unwatch.
 */
function watchLog(logId, onLine) {
  const log = KNOWN_LOGS.find(l => l.id === logId);
  if (!log || !fs.existsSync(log.path)) return () => {};

  let pos = fs.statSync(log.path).size;
  let watcher = null;

  try {
    watcher = fs.watch(log.path, () => {
      try {
        const stat = fs.statSync(log.path);
        if (stat.size <= pos) return; // Truncated or same size
        const fd = fs.openSync(log.path, 'r');
        const buf = Buffer.alloc(stat.size - pos);
        fs.readSync(fd, buf, 0, buf.length, pos);
        fs.closeSync(fd);
        pos = stat.size;
        const newText = buf.toString('utf8');
        const newLines = newText.split('\n').filter(Boolean);
        for (const line of newLines) onLine(line);
      } catch {}
    });
  } catch {}

  return () => { try { watcher?.close(); } catch {} };
}

/**
 * Start watching all active log files and emit via Socket.io.
 * Returns a stop() function.
 */
function startLogWatcher(io) {
  const stops = [];
  for (const log of KNOWN_LOGS) {
    if (!fs.existsSync(log.path)) continue;
    const stop = watchLog(log.id, (line) => {
      io.emit('log_line', { logId: log.id, label: log.label, line });
    });
    stops.push(stop);
  }
  return () => stops.forEach(s => s());
}

module.exports = { listLogs, tailLog, watchLog, startLogWatcher, KNOWN_LOGS };
