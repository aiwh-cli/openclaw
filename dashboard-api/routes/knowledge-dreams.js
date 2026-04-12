// ─── Knowledge Dreams Routes ─────────────────────────────────
// Proxy gateway RPC calls for Memory Dreaming status, diary, and config toggle.
// The gateway handles all dreaming logic; we just bridge the dashboard HTTP API.
const { client: gateway } = require('../gateway-ws');

module.exports = (app, deps) => {
  const { dashLog } = deps;

  // ─── Dreams Status ──────────────────────────────────────────
  app.get('/api/knowledge/dreams/status', async (req, res) => {
    try {
      await gateway.ensureConnected(5000);
      const result = await gateway.request('doctor.memory.status', {}, 15000);
      res.json({
        ok: true,
        dreaming: result?.dreaming || null,
        embedding: result?.embedding || null,
      });
    } catch (e) {
      dashLog('knowledge-dreams', `status error: ${e.message}`);
      res.status(502).json({ ok: false, error: 'Gateway request failed' });
    }
  });

  // ─── Dream Diary ────────────────────────────────────────────
  app.get('/api/knowledge/dreams/diary', async (req, res) => {
    try {
      await gateway.ensureConnected(5000);
      const result = await gateway.request('doctor.memory.dreamDiary', {}, 15000);
      res.json({
        ok: true,
        found: result?.found || false,
        path: result?.path || null,
        content: result?.content || null,
        updatedAtMs: result?.updatedAtMs || null,
      });
    } catch (e) {
      dashLog('knowledge-dreams', `diary error: ${e.message}`);
      res.status(502).json({ ok: false, error: 'Gateway request failed' });
    }
  });

  // ─── Toggle Dreaming ────────────────────────────────────────
  app.post('/api/knowledge/dreams/toggle', async (req, res) => {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'enabled must be a boolean' });
    }
    try {
      await gateway.ensureConnected(5000);
      // config.patch requires baseHash for optimistic concurrency
      const configSnapshot = await gateway.request('config.get', {}, 10000);
      const baseHash = configSnapshot?.hash || configSnapshot?.baseHash;
      if (!baseHash) {
        return res.status(502).json({ ok: false, error: 'Could not read config hash' });
      }
      await gateway.request('config.patch', {
        baseHash,
        raw: JSON.stringify({
          plugins: {
            entries: {
              'memory-core': {
                config: {
                  dreaming: { enabled },
                },
              },
            },
          },
        }),
      }, 15000);
      res.json({ ok: true, enabled });
    } catch (e) {
      dashLog('knowledge-dreams', `toggle error: ${e.message}`);
      res.status(502).json({ ok: false, error: 'Gateway request failed' });
    }
  });
};
