// ─── Routes: Chat (SSE Gateway Proxy) ────────────────────────
const fs = require('fs');
const path = require('path');
const { canAccessAgent } = require('../helpers/rbac');

// Personal CC agents get user-scoped session keys for data isolation (AB.12.6)
const PERSONAL_CC_AGENTS = new Set(['wcc-agent', 'coach', 'travel', 'health-tracker']);
function scopeSessionForUser(sessionId, agentId, user) {
  if (!user?.userId || !PERSONAL_CC_AGENTS.has(agentId)) return sessionId;
  // If already a full key with user scope, keep it
  if (sessionId.includes(`:user:${user.userId}:`)) return sessionId;
  // Build user-scoped key
  return `agent:${agentId}:user:${user.userId}:main`;
}

// Department-lead gets per-user-per-department session keys (AC.1)
// Validates departmentId against departments.json to prevent session-key injection.
const DEPT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
function scopeSessionForDeptLead(sessionId, agentId, user, departmentId) {
  if (agentId !== 'department-lead' || !user?.userId || !departmentId) return sessionId;
  if (!DEPT_ID_RE.test(departmentId)) return sessionId;
  // Confirm the user actually has access to this department (belt-and-braces — RBAC should already gate)
  const userDepts = Array.isArray(user.departments) ? user.departments : [];
  if (user.role !== 'owner' && user.role !== 'admin' && !userDepts.includes(departmentId)) return sessionId;
  if (sessionId.includes(`:user:${user.userId}:dept:`)) return sessionId;
  return `agent:department-lead:user:${user.userId}:dept:${departmentId}:main`;
}

const CORE = '/opt/AIWH/core';

// Session visibility filter — hides sessions that don't belong to the current user
// or reference a department they no longer have access to.
// Owners see everything. Admins see their own + shared-scope sessions. Team users
// see only their own sessions, scoped to their current department allowlist.
function canSeeSession(sessionKey, user) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  const key = String(sessionKey || '');
  const userMatch = key.match(/:user:([0-9a-f-]{8,})/i);
  if (userMatch) {
    // Any user-scoped session is strictly owned — must match current user
    if (userMatch[1] !== user.userId) return false;
    // If the session is also dept-scoped, require current dept access
    const deptMatch = key.match(/:dept:([a-z0-9_-]+)/i);
    if (deptMatch) {
      const userDepts = Array.isArray(user.departments) ? user.departments : [];
      if (user.role === 'team' && !userDepts.includes(deptMatch[1])) return false;
    }
    return true;
  }
  // Non-user-scoped session. Team users never see these (no provenance).
  if (user.role === 'team') return false;
  // Admins see non-user-scoped sessions only for agents they can access.
  const parts = key.split(':');
  const agentId = parts.length >= 2 ? parts[1] : '';
  return agentId ? canAccessAgent(user, agentId) : false;
}

// Session key validation: alphanumeric + : . _ - only, max 200 chars
const SESSION_KEY_RE = /^[a-zA-Z0-9_:.\-]{1,200}$/;
function isValidSessionKey(key) {
  return typeof key === 'string' && SESSION_KEY_RE.test(key);
}

module.exports = function(app, deps) {
  const { db, io, adapter, chatProxy } = deps;

// ─── ROUTES: Chat (project-scoped, legacy) ──────────────────
app.get('/api/projects/:projectId/chat', (req, res) => {
  const session = req.query.session || 'default';
  const msgs = db.prepare(
    'SELECT * FROM chat_messages WHERE project_id=? AND session_id=? ORDER BY created_at'
  ).all(req.params.projectId, session);
  res.json(msgs);
});

app.post('/api/projects/:projectId/chat', (req, res) => {
  const { message, session, agent_id } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const projectId = parseInt(req.params.projectId);
  const sessionId = session || 'default';
  const agentId = agent_id || 'main';

  // Save user message
  db.prepare('INSERT INTO chat_messages (project_id, session_id, role, content) VALUES (?,?,?,?)')
    .run(projectId, sessionId, 'user', message);

  // Get project context
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);

  // Stream response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  let fullResponse = '';
  adapter.executeAgent(agentId, message, {
    cwd: project?.root_dir || CORE,
    onData: (chunk) => {
      fullResponse += chunk;
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    },
    onClose: (result) => {
      // Save assistant response
      db.prepare('INSERT INTO chat_messages (project_id, session_id, role, content, model) VALUES (?,?,?,?,?)')
        .run(projectId, sessionId, 'assistant', fullResponse, agentId);
      res.write(`data: ${JSON.stringify({ done: true, exitCode: result.exitCode })}\n\n`);
      res.end();
    }
  });

  req.on('close', () => { /* client disconnected */ });
});

// ─── ROUTES: Chat Proxy (SSE → Gateway) ─────────────────────
// Decoupled from projects — sessions identified by agentId + sessionId
// Track session clears — when /new is sent, record timestamp so history can filter
const _sessionClearTimes = new Map();

app.post('/api/chat', (req, res) => {
  const { message, agentId = 'main', departmentId } = req.body;
  let { sessionId = 'default' } = req.body;
  if (!canAccessAgent(req.user, agentId)) return res.status(403).json({ error: 'You do not have access to this agent' });
  // User-scope personal CC agents so each user gets isolated conversations
  sessionId = scopeSessionForUser(sessionId, agentId, req.user);
  // Department-scope department-lead so team users get per-department isolation (AC.1)
  sessionId = scopeSessionForDeptLead(sessionId, agentId, req.user, departmentId);
  req.body.sessionId = sessionId;
  if (sessionId !== 'default' && !isValidSessionKey(sessionId)) return res.status(400).json({ error: 'Invalid session key format' });
  if (message?.trim() === '/new') {
    const sessionKey = (sessionId && sessionId !== 'default' && sessionId.includes(':'))
      ? sessionId : `agent:${agentId}:main`;
    _sessionClearTimes.set(sessionKey, new Date().toISOString());
  }
  chatProxy.chatSseHandler(req, res, db);
});

app.get('/api/gateway/status', (req, res) => {
  const { client: gateway } = require('../gateway-ws');
  res.json({ connected: gateway.connected });
});

// Reset session — sends /new via chat.send which the gateway handles as a reset trigger
// Old transcript is archived as .reset.{timestamp}, sessionKey stays the same, new sessionId is minted
app.post('/api/chat/new', async (req, res) => {
  const { agentId = 'main', sessionId = 'default' } = req.body;
  if (!canAccessAgent(req.user, agentId)) return res.status(403).json({ error: 'You do not have access to this agent' });
  if (sessionId !== 'default' && !isValidSessionKey(sessionId)) return res.status(400).json({ error: 'Invalid session key format' });
  const sessionKey = (sessionId && sessionId !== 'default' && sessionId.includes(':'))
    ? sessionId : `agent:${agentId}:main`;

  try {
    const { client: gateway } = require('../gateway-ws');
    const { randomUUID } = require('crypto');

    // Send /new as a chat.send — gateway intercepts reset triggers before agent processing
    // The gateway creates a fresh sessionId, archives the old transcript, and runs a greeting turn
    const result = await gateway.request('chat.send', {
      sessionKey,
      message: '/new',
      deliver: false,
      idempotencyKey: randomUUID(),
      attachments: [],
    }, 15000);

    // Record the clear time so subsequent history requests filter old messages
    _sessionClearTimes.set(sessionKey, new Date().toISOString());

    res.json({ ok: true, result });
  } catch (e) {
    console.log('[chat/new] error:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/chat/abort', async (req, res) => {
  const { agentId = 'main', sessionId } = req.body;
  if (sessionId && !isValidSessionKey(sessionId)) return res.status(400).json({ error: 'Invalid session key format' });
  // Use full sessionKey for gateway abort — not just agentId
  const sessionKey = sessionId || `agent:${agentId}:main`;
  const result = await chatProxy.abortChat(sessionKey);
  res.json(result);
});

app.get('/api/chat/history', async (req, res) => {
  const { agentId = 'main', sessionId, limit = 50 } = req.query;
  if (sessionId && sessionId !== 'default' && !isValidSessionKey(sessionId)) return res.status(400).json({ error: 'Invalid session key format' });
  // Use sessionId as the gateway sessionKey if provided (e.g. "agent:main:cron:uuid")
  // Map 'default' → 'agent:{agentId}:main' which is OpenClaw's main session format
  // Fall back to just agentId for simple cases
  let sessionKey;
  if (sessionId && sessionId !== 'default' && sessionId !== agentId) {
    sessionKey = sessionId;
  } else {
    sessionKey = `agent:${agentId}:main`;
  }
  if (!canSeeSession(sessionKey, req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    // Fetch from gateway (real conversation history)
    const { client: gateway } = require('../gateway-ws');
    const result = await gateway.request('chat.history', { sessionKey, limit: parseInt(limit) }, 8000);
    let msgs = (result?.messages || []).map(m => {
      const blocks = Array.isArray(m.content) ? m.content : [];
      // Gateway uses camelCase: toolCall (not tool_use), and role 'toolResult' (not tool_result blocks)
      const textContent = typeof m.content === 'string' ? m.content
        : blocks.filter(b => b.type === 'text').map(b => b.text).join('');
      // Extract toolCall blocks (assistant calling tools)
      const toolUses = blocks.filter(b => b.type === 'toolCall' || b.type === 'tool_use').map(b => ({
        id: b.id, name: b.name, input: b.arguments || b.input || {},
      }));
      // For toolResult messages (role='toolResult'), the text blocks ARE the tool output
      // Mark them as tool_results so the client renders them as compact cards
      const toolResults = [];
      if (m.role === 'toolResult') {
        toolResults.push({
          tool_use_id: m.toolCallId || '',
          content: textContent,
          is_error: m.isError || false,
        });
      }
      // Also handle inline tool_result blocks (Anthropic format)
      blocks.filter(b => b.type === 'tool_result').forEach(b => {
        toolResults.push({
          tool_use_id: b.tool_use_id || '',
          content: typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.filter(x => x.type === 'text').map(x => x.text).join('') : '',
          is_error: b.is_error || false,
        });
      });
      const created_at = m.createdAt || m.created_at || m.timestamp || m.sentAt || null;
      // Strip agent alias block that gets prepended to user messages
      let cleanContent = textContent;
      if (m.role === 'user' && cleanContent.includes('## Agent Aliases')) {
        cleanContent = cleanContent.replace(/^## Agent Aliases[\s\S]*?---\s*/, '').trim();
      }
      // Strip department-lead context injection block (AC.1)
      if (m.role === 'user' && cleanContent.includes('[AIWH-DEPT-CONTEXT:')) {
        cleanContent = cleanContent.replace(/^\[AIWH-DEPT-CONTEXT:[^\]]*\][\s\S]*?---\s*/, '').trim();
      }
      // For toolResult messages, don't put the output in content (it goes in tool_results)
      if (m.role === 'toolResult') cleanContent = '';
      const normalizedRole = m.role === 'toolResult' ? 'tool' : m.role;
      // Build content as array of typed blocks for extractToolCards() compatibility.
      // extractToolCards expects: { type: "tool_use", name, arguments } and { type: "tool_result", text }
      const contentBlocks = [];
      if (cleanContent) {
        contentBlocks.push({ type: 'text', text: cleanContent });
      }
      for (const tu of toolUses) {
        contentBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, arguments: tu.input || {} });
      }
      for (const tr of toolResults) {
        contentBlocks.push({ type: 'tool_result', tool_use_id: tr.tool_use_id, text: tr.content, is_error: tr.is_error });
      }
      // Use content blocks array if there are tool calls/results, plain string otherwise
      const content = (toolUses.length || toolResults.length) ? contentBlocks : cleanContent;
      const msg = { role: normalizedRole, content, created_at, agent_id: agentId };
      // Pass through usage, cost, and model metadata for per-message display
      if (m.usage) msg.usage = m.usage;
      if (m.cost) msg.cost = m.cost;
      if (m.model) msg.model = m.model;
      return msg;
    });

    // Filter messages after last /new clear (if any)
    const clearTime = _sessionClearTimes.get(sessionKey);
    if (clearTime) {
      const clearTs = new Date(clearTime).getTime();
      // Keep only messages created after the /new clear
      const filtered = msgs.filter(m => {
        if (!m.created_at) return true; // keep messages without timestamps
        return new Date(m.created_at).getTime() >= clearTs;
      });
      // Only apply filter if it keeps at least some messages (avoid empty on race condition)
      if (filtered.length > 0) msgs = filtered;
    }

    // Calculate current context size
    let contextMsgs = msgs;
    const contextChars = contextMsgs.reduce((sum, m) => sum + (m.content || '').length, 0);
    const conversationTokens = Math.round(contextChars / 4);

    // OpenClaw session overhead: system prompt (~9.6k) + tool schemas (~8k) + bootstrap files
    // Bootstrap files loaded once at session start and stay in context:
    // AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, MEMORY.md,
    // HARD-LIMITS.md, CONTEXT.md, BOOTSTRAP.md + memory/today.md + memory/yesterday.md
    // Each capped at 20k chars (bootstrapMaxChars default).
    let bootstrapChars = 0;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const bootstrapFiles = [
      'AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md',
      'HEARTBEAT.md', 'MEMORY.md', 'HARD-LIMITS.md', 'CONTEXT.md', 'BOOTSTRAP.md',
      `memory/${today}.md`, `memory/${yesterday}.md`,
    ];
    for (const bf of bootstrapFiles) {
      try {
        const bfPath = path.join('/opt/AIWH/core', bf);
        const stat = fs.statSync(bfPath);
        bootstrapChars += Math.min(stat.size, 20000);
      } catch {}
    }
    const systemOverhead = Math.round((9600 + 8000) + (bootstrapChars / 4)); // system prompt + tool schemas + bootstrap files
    const totalTokens = conversationTokens + systemOverhead;

    res.json({ messages: msgs, context: {
      tokens: totalTokens,
      conversationTokens,
      systemOverhead,
      messageCount: contextMsgs.length,
    } });
  } catch (e) {
    // Fall back to SQLite local history
    const msgs = chatProxy.getChatHistory(db, agentId, sessionId || 'default', parseInt(limit));
    res.json(msgs);
  }
});

app.get('/api/chat/sessions', async (req, res) => {
  const { agentId } = req.query;

  // Try gateway ACP sessions.list first
  const gatewaySessions = await chatProxy.listGatewaySessions(agentId || undefined);

  if (gatewaySessions !== null && Array.isArray(gatewaySessions)) {
    // Normalise gateway session objects to our expected shape
    const normalized = gatewaySessions.map(s => {
      const key = s.sessionKey || s.key || s.id || '';
      const parts = key.split(':');
      // sessionKey format: "agent:agentId:sessionType:name" or just "agentId"
      const detectedAgent = parts.length >= 2 ? parts[1] : (s.agentId || parts[0] || '');
      const kind = key.includes(':cron:') ? 'cron' : key.includes(':spawn:') ? 'spawn' : 'session';
      return {
        agent_id: detectedAgent,
        session_id: key,
        label: s.label || s.name || key,
        kind,
        tokens: s.totalTokens || s.tokens || 0,
        cost: s.totalCost || s.cost || 0,
        model: s.model || '',
        last_message_at: s.updatedAt || s.lastUpdated || s.updated_at || null,
        message_count: s.messageCount || s.messages || 0,
        source: 'openclaw',
      };
    });

    // Filter out hidden sessions + enforce per-user / per-department visibility
    const visible = normalized.filter(s =>
      !chatProxy.isSessionHidden(s.session_id) && canSeeSession(s.session_id, req.user),
    );
    visible.sort((a, b) => {
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return tb - ta;
    });

    return res.json(visible);
  }

  // Fallback: file-based reading (if gateway unavailable)
  const localSessions = chatProxy.listChatSessions(db);
  const openclawSessions = [];

  const agentsDir = '/opt/AIWH/.openclaw/agents';
  if (fs.existsSync(agentsDir)) {
    try {
      const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name);
      for (const aid of agentDirs) {
        const sessDir = path.join(agentsDir, aid, 'sessions');
        if (!fs.existsSync(sessDir)) continue;
        const sessionsFile = path.join(sessDir, 'sessions.json');
        if (fs.existsSync(sessionsFile)) {
          try {
            const data = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
            const sessions = data.sessions || data;
            const iterate = (s, key) => {
              openclawSessions.push({
                agent_id: aid,
                session_id: s.sessionId || s.key || s.id || key || 'unknown',
                label: s.label || key || s.sessionId || '',
                kind: key?.includes(':cron:') ? 'cron' : (key?.includes(':spawn:') ? 'spawn' : 'session'),
                tokens: s.totalTokens || s.tokens || 0,
                model: s.model || '',
                last_message_at: s.updatedAt ? new Date(s.updatedAt).toISOString() : (s.lastUpdated ? new Date(s.lastUpdated).toISOString() : null),
                message_count: s.messageCount || s.messages || 0,
                source: 'openclaw',
              });
            };
            if (Array.isArray(sessions)) sessions.forEach(s => iterate(s, s.key || s.id));
            else if (typeof sessions === 'object') {
              for (const [key, s] of Object.entries(sessions)) iterate(s, key);
            }
          } catch {}
        }
      }
    } catch {}
  }

  const all = [
    ...openclawSessions.sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || '')),
    ...localSessions.map(s => ({ ...s, source: 'local' })),
  ].filter(s => canSeeSession(s.session_id, req.user));
  res.json(all);
});

app.delete('/api/chat/sessions/:sessionKey', async (req, res) => {
  const sessionKey = decodeURIComponent(req.params.sessionKey);
  if (!isValidSessionKey(sessionKey)) return res.status(400).json({ error: 'Invalid session key format' });
  if (!canSeeSession(sessionKey, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const result = await chatProxy.deleteSession(sessionKey);
  res.json(result);
});

app.patch('/api/chat/sessions/:sessionKey', async (req, res) => {
  const sessionKey = decodeURIComponent(req.params.sessionKey);
  if (!isValidSessionKey(sessionKey)) return res.status(400).json({ error: 'Invalid session key format' });
  if (!canSeeSession(sessionKey, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const { label } = req.body;
  const result = await chatProxy.patchSession(sessionKey, { label });
  res.json(result);
});

app.get('/api/chat/sessions/:sessionKey/usage', async (req, res) => {
  const sessionKey = decodeURIComponent(req.params.sessionKey);
  if (!isValidSessionKey(sessionKey)) return res.status(400).json({ error: 'Invalid session key format' });
  if (!canSeeSession(sessionKey, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const usage = await chatProxy.getSessionUsage(sessionKey);
  res.json(usage || { error: 'unavailable' });
});

// Get current model for an agent (from latest session JSONL)
app.get('/api/chat/model/:agentId', (req, res) => {
  const agentId = req.params.agentId;

  // Primary: read configured model from openclaw.json
  try {
    const ocPath = '/opt/AIWH/.openclaw/openclaw.json';
    const oc = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
    const agent = (oc.agents?.list || []).find(a => a.id === agentId);
    const configured = agent?.model;
    // If agent has no explicit model, use the default
    const defaultModel = typeof oc.agents?.defaults?.model === 'string'
      ? oc.agents.defaults.model
      : oc.agents?.defaults?.model?.primary;
    const model = configured || defaultModel || null;
    if (model) return res.json({ model });
  } catch {}

  // Fallback: read from last session event
  const sessDir = path.join('/opt/AIWH/.openclaw/agents', agentId, 'sessions');
  if (!fs.existsSync(sessDir)) return res.json({ model: null });
  try {
    const files = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl'));
    if (!files.length) return res.json({ model: null });
    const latest = files.map(f => ({ f, mtime: fs.statSync(path.join(sessDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    const content = fs.readFileSync(path.join(sessDir, latest.f), 'utf8');
    let lastModel = null;
    for (const line of content.split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.type === 'model_change') lastModel = e.modelId || null;
        else if (e.type === 'custom' && e.customType === 'openclaw.cache-ttl' && e.data?.modelId) {
          lastModel = e.data.modelId;
        }
      } catch {}
    }
    res.json({ model: lastModel });
  } catch { res.json({ model: null }); }
});

// Set model for an agent session via gateway config
app.post('/api/chat/model/:agentId', async (req, res) => {
  const agentId = req.params.agentId;
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model required' });

  // Resolve shorthand aliases to full model IDs
  const modelMap = {
    // Anthropic
    opus: 'anthropic/claude-opus-4-6',
    sonnet: 'anthropic/claude-sonnet-4-5',
    haiku: 'anthropic/claude-haiku-4-5',
    // OpenAI (direct)
    'gpt-4o': 'openai/gpt-4o',
    'gpt-4o-mini': 'openai/gpt-4o-mini',
    codex: 'openai-codex/gpt-5.4',
    // OpenRouter popular models
    'gemini-flash': 'openrouter/google/gemini-2.5-flash',
    'gemini-pro': 'openrouter/google/gemini-2.5-pro',
    auto: 'openrouter/auto',
  };
  const modelId = modelMap[model.toLowerCase()] || model;

  try {
    const { client: gateway } = require('../gateway-ws');
    const sessionKey = `agent:${agentId}:main`;
    await gateway.request('config.set', { sessionKey, key: 'model', value: modelId }, 5000);
    res.json({ ok: true, model: modelId });
  } catch (e) {
    // Fallback: write to openclaw.json directly
    try {
      const ocPath = '/opt/AIWH/.openclaw/openclaw.json';
      const oc = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
      const agentList = oc.agents?.list || [];
      const agent = agentList.find(a => a.id === agentId);
      const fullModelId = modelId.includes('/') ? modelId
        : modelId.startsWith('claude-') ? `anthropic/${modelId}`
        : modelId;
      if (agent) {
        agent.model = fullModelId;
        fs.writeFileSync(ocPath, JSON.stringify(oc, null, 2));
        res.json({ ok: true, model: modelId, method: 'config-file' });
      } else {
        res.json({ ok: false, error: `Agent ${agentId} not found in config` });
      }
    } catch (e2) {
      res.json({ ok: false, error: e2.message });
    }
  }
});

};
