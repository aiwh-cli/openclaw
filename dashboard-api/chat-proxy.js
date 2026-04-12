// ─── Chat Proxy ─────────────────────────────────────────────
// Routes chat messages to OpenClaw Gateway via WebSocket ACP protocol.
//
// ACP stream event format (from gateway):
//   { type:"event", event:"stream", sessionKey:"main", runId:"...",
//     state:"delta"|"final"|"aborted", message:{role, content} }
//
// Session key for main agent is simply "main".
// Other agents use their agent ID directly as the session key.

const { randomUUID } = require('crypto');
const { client: gateway } = require('./gateway-ws');

let _buildAgentAliasMap = null;
function setBuildAliasMap(fn) { _buildAgentAliasMap = fn; }

/**
 * Extract text string from a message object or string.
 * Handles both string content and array-of-blocks content.
 */
function extractText(message) {
  if (!message) return '';
  const content = typeof message === 'string' ? message : message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('');
  }
  return '';
}

/**
 * Express SSE route handler for chat.
 * POST /api/chat
 * Body: { message, agentId, sessionId }
 *
 * Two-path approach:
 *  1. Subscribe to gateway stream events (real-time deltas, if gateway delivers them).
 *  2. Poll chat.history every 2s as a guaranteed fallback — response always appears.
 *
 * Streams SSE events to the browser:
 *   { type:"delta", delta:"..." }   — partial text chunk
 *   { type:"done", error:null }      — complete
 *   { type:"error", error:"..." }    — failure
 */
async function chatSseHandler(req, res, db) {
  const { message, agentId = 'main', sessionId = 'default', departmentId, attachments: rawAttachments } = req.body;
  if (!message?.trim() && !(Array.isArray(rawAttachments) && rawAttachments.length)) return res.status(400).json({ error: 'message or attachment required' });

  // Validate attachments: only image/* types, must have content
  const validAttachments = (Array.isArray(rawAttachments) ? rawAttachments : []).filter(a =>
    a && typeof a.content === 'string' && typeof a.mimeType === 'string' && /^image\//.test(a.mimeType)
  ).map(a => ({ type: 'image', mimeType: a.mimeType, content: a.content }));

  // Use sessionId as the real gateway sessionKey if it looks like a full key (agent:x:y)
  // Otherwise construct from agentId
  const sessionKey = (sessionId && sessionId !== 'default' && sessionId.includes(':'))
    ? sessionId
    : `agent:${agentId}:main`;
  const idempotencyKey = randomUUID();

  // Persist user message locally
  db.prepare(
    'INSERT INTO chat_messages (agent_id, session_id, role, content) VALUES (?,?,?,?)'
  ).run(agentId, sessionId, 'user', message);

  // Open SSE stream and immediately flush a heartbeat comment so the browser
  // knows the connection is live (headers are sent on first write).
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': heartbeat\n\n');

  let streamDone = false;
  let fullText = '';
  let unsubscribeStream = null;
  let pollTimer = null;
  let messageSent = false; // Guard: ignore stale stream events from previous requests

  const finish = (text) => {
    if (streamDone) return;
    streamDone = true;
    if (unsubscribeStream) { unsubscribeStream(); unsubscribeStream = null; }
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'done', error: null })}\n\n`);
      res.end();
    }
  };

  // Use res.on('close') — fires when the SSE response socket drops.
  // req.on('close') fires when the request body is fully read by body-parser (too early).
  res.on('close', () => { streamDone = true; });

  // ── Path 1: Stream events (real-time) ──────────────────────
  // Gateway broadcasts 'chat' events (deltas/final) and 'agent'/'session.tool' events (tool use).
  unsubscribeStream = gateway.onStream(sessionKey, (evt) => {
    if (streamDone) return;
    if (!messageSent) return; // Ignore stale events from previous runs

    const evtType = evt.event || 'stream';
    console.log(`[chat-proxy] ${evtType} evt:`, JSON.stringify(evt).slice(0, 200));

    // Normalise: gateway may wrap fields in .payload
    const src = (evt.state !== undefined || evt.message !== undefined)
      ? evt : (evt.payload || evt);
    const state = src.state;

    // Handle tool use events (agent/session.tool)
    if (evtType === 'agent' || evtType === 'session.tool') {
      const data = src.data || src;
      const toolName = data.toolName || data.name || data.tool;
      const phase = data.phase || data.status;
      const toolCallId = data.toolCallId || data.id || '';

      if (toolName && (phase === 'running' || phase === 'start' || !phase)) {
        res.write(`data: ${JSON.stringify({
          type: 'tool_start',
          name: toolName,
          toolCallId,
          args: data.args || data.arguments || undefined,
        })}\n\n`);
      } else if (phase === 'end' || phase === 'complete' || phase === 'done' || phase === 'result') {
        res.write(`data: ${JSON.stringify({
          type: 'tool_end',
          toolCallId,
          name: toolName,
          output: data.result || data.output || data.partialResult || undefined,
        })}\n\n`);
      } else if (phase === 'update') {
        // Partial result update during tool execution
        res.write(`data: ${JSON.stringify({
          type: 'agent_event',
          toolCallId,
          name: toolName,
          phase: 'update',
          partialResult: data.partialResult || data.result || undefined,
        })}\n\n`);
      }
      // lifecycle end events signal the run is complete
      if (data.stream === 'lifecycle' && (phase === 'end' || phase === 'error')) {
        // Don't finish here — wait for 'final' state from chat events
      }
      return;
    }

    // Handle chat/stream text events
    if (state === 'delta') {
      const delta = extractText(src.message);
      if (delta) { fullText += delta; res.write(`data: ${JSON.stringify({ type: 'delta', delta })}\n\n`); }

    } else if (state === 'final') {
      const finalText = extractText(src.message) || fullText;
      if (finalText && !fullText) {
        res.write(`data: ${JSON.stringify({ type: 'delta', delta: finalText })}\n\n`);
      }
      finish(finalText);

    } else if (state === 'aborted') {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'aborted' })}\n\n`);
      finish('');
    }
  });

  // ── Path 2: Polling fallback ────────────────────────────────
  // Record the timestamp of the last known message before sending,
  // then poll for any newer assistant message.
  let lastKnownTs = Date.now();
  try {
    const hist = await gateway.request('chat.history', { sessionKey, limit: 100 }, 5000);
    const msgs = hist?.messages || [];
    if (msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1];
      const ts = lastMsg.createdAt || lastMsg.created_at || lastMsg.timestamp || lastMsg.sentAt;
      if (ts) lastKnownTs = typeof ts === 'number' ? ts : new Date(ts).getTime();
    }
    console.log('[chat-proxy] history baseline: msgs=', msgs.length, 'lastKnownTs=', lastKnownTs);
  } catch (e) {
    console.log('[chat-proxy] baseline error:', e.message);
  }

  // ── Send message (fire-and-forget — do NOT await the ack) ──
  // Prepend agent alias map so the agent can resolve custom names to IDs
  // BUT never prepend to slash commands — gateway must see them as the first character
  const isSlashCommand = message.trim().startsWith('/');
  const aliasBlock = (!isSlashCommand && _buildAgentAliasMap) ? _buildAgentAliasMap() : '';

  // Department-lead context injection (AC.1)
  // On the first message of each dept-lead session, prepend a scope block so
  // the agent knows which department + user it is serving. Stripped from history
  // by routes/chat.js similar to the agent alias block.
  let deptBlock = '';
  if (!isSlashCommand && agentId === 'department-lead' && departmentId && req.user?.userId) {
    try {
      const { loadDepartments } = require('./openclaw-adapter');
      const depts = loadDepartments();
      const dept = (depts?.departments || []).find(d => d.id === departmentId);
      // Only inject on the first turn — check history
      let firstTurn = true;
      try {
        const hist = await gateway.request('chat.history', { sessionKey, limit: 2 }, 3000);
        if ((hist?.messages || []).some(m => m.role === 'user')) firstTurn = false;
      } catch { /* no history yet */ }
      if (dept && firstTurn) {
        // AC.5: sanitize ALL fields — `]` or newlines would break the strip regex in routes/chat.js
        const clean = (v) => String(v ?? '').replace(/[\r\n\]]/g, ' ');
        const agents = Array.isArray(dept.agents) ? dept.agents.map(clean).join(', ') : '';
        const safeName = clean(dept.name || departmentId);
        const safeId = clean(dept.id);
        const safeUser = clean(req.user.displayName || req.user.email || 'team');
        const safeRole = clean(req.user.role || 'team');
        const safeCC = clean(dept.command_centre || 'business');
        deptBlock = `[AIWH-DEPT-CONTEXT: department=${safeName} id=${safeId} agents=${agents} user=${safeUser} role=${safeRole} cc=${safeCC}]`;
      }
    } catch (e) {
      console.log('[chat-proxy] dept context inject error:', e.message);
    }
  }

  const prefixParts = [];
  if (aliasBlock) prefixParts.push(aliasBlock);
  if (deptBlock) prefixParts.push(deptBlock);
  const enrichedMessage = prefixParts.length
    ? `${prefixParts.join('\n\n')}\n---\n\n${message}`
    : message;

  // Mark messageSent BEFORE firing so stream events from this point on are processed.
  messageSent = true;
  gateway.request('chat.send', {
    sessionKey,
    message: enrichedMessage,
    deliver: false,
    idempotencyKey,
    attachments: validAttachments,
  }, 60000).then(r => {
    console.log('[chat-proxy] chat.send ack:', JSON.stringify(r).slice(0, 100));
  }).catch(err => {
    console.log('[chat-proxy] chat.send error:', err.message);
  });

  // Use recursive setTimeout instead of setInterval to avoid async callback overlap
  let pollCount = 0;
  const schedulePoll = () => {
    if (streamDone) { console.log('[chat-proxy] poll stopped (done)'); return; }
    pollTimer = setTimeout(async () => {
      if (streamDone) { console.log('[chat-proxy] poll stopped (done)'); return; }
      pollCount++;
      console.log('[chat-proxy] poll #' + pollCount + ' running');
      try {
        const hist = await gateway.request('chat.history', { sessionKey, limit: 100 }, 5000);
        const msgs = hist?.messages || [];
        // Find any assistant message newer than our baseline
        const newAssistant = msgs.filter(m => {
          if (m.role !== 'assistant') return false;
          const ts = m.createdAt || m.created_at || m.timestamp || m.sentAt;
          if (!ts) return false;
          const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
          return t > lastKnownTs;
        });
        console.log('[chat-proxy] poll #' + pollCount + ': msgs=' + msgs.length + ' newAssistant=' + newAssistant.length);
        if (newAssistant.length > 0) {
          const latest = newAssistant[newAssistant.length - 1];
          const text = extractText(latest) || (typeof latest?.content === 'string' ? latest.content : '');
          console.log('[chat-proxy] poll found response, len=', text.length, 'role=', latest.role, 'contentType=', typeof latest.content, 'isArray=', Array.isArray(latest.content), 'sample=', JSON.stringify(latest.content)?.slice(0, 200));
          if (text && !fullText) {
            res.write(`data: ${JSON.stringify({ type: 'delta', delta: text })}\n\n`);
            fullText = text;
          }
          finish(text || fullText);
          return; // stop polling
        }
      } catch (e) {
        console.log('[chat-proxy] poll error:', e.message);
      }
      schedulePoll(); // schedule next
    }, 2000);
  };
  console.log('[chat-proxy] starting poll scheduler');
  schedulePoll();
}

/**
 * Get chat history for a session from the local SQLite store.
 */
function getChatHistory(db, agentId, sessionId, limit = 50) {
  return db.prepare(
    'SELECT * FROM chat_messages WHERE agent_id=? AND session_id=? ORDER BY created_at DESC LIMIT ?'
  ).all(agentId, sessionId || 'default', limit).reverse();
}

/**
 * List recent chat sessions grouped by agent+session.
 */
function listChatSessions(db) {
  return db.prepare(`
    SELECT agent_id, session_id,
           COUNT(*) as message_count,
           MAX(created_at) as last_message_at,
           (SELECT content FROM chat_messages cm2
            WHERE cm2.agent_id = cm.agent_id AND cm2.session_id = cm.session_id
            ORDER BY created_at DESC LIMIT 1) as last_message
    FROM chat_messages cm
    GROUP BY agent_id, session_id
    ORDER BY last_message_at DESC
    LIMIT 20
  `).all();
}

/**
 * List sessions from gateway via ACP sessions.list method.
 * Optionally filter by agentId.
 */
async function listGatewaySessions(agentId) {
  try {
    const params = {};
    if (agentId) params.agentId = agentId;
    const result = await gateway.request('sessions.list', params, 10000);
    return result?.sessions || result || [];
  } catch (e) {
    console.log('[chat-proxy] sessions.list error:', e.message);
    return null; // null = gateway unavailable, fallback to file-based
  }
}

/**
 * Delete a session via gateway ACP.
 */
// Sessions hidden by the user (gateway doesn't support delete for webchat clients)
const _hiddenSessions = new Set();

async function deleteSession(sessionKey) {
  // Can't actually delete via gateway — just hide from the list
  _hiddenSessions.add(sessionKey);
  return { ok: true };
}

function isSessionHidden(sessionKey) {
  return _hiddenSessions.has(sessionKey);
}

/**
 * Rename/patch a session via gateway ACP.
 */
async function patchSession(sessionKey, updates) {
  try {
    await gateway.request('sessions.patch', { key: sessionKey, ...updates }, 5000);
    return { ok: true };
  } catch (e) {
    console.log('[chat-proxy] sessions.patch error:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Get session usage stats via gateway ACP.
 */
async function getSessionUsage(sessionKey) {
  try {
    const result = await gateway.request('sessions.usage', { sessionKey }, 5000);
    return result;
  } catch (e) {
    console.log('[chat-proxy] sessions.usage error:', e.message);
    return null;
  }
}

/**
 * Abort an active chat generation via gateway ACP.
 * Sends chat.abort to stop the running agent.
 */
async function abortChat(sessionKey) {
  try {
    await gateway.request('chat.abort', { sessionKey }, 5000);
    return { ok: true };
  } catch (e) {
    console.log('[chat-proxy] abort error:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  chatSseHandler, getChatHistory, listChatSessions, setBuildAliasMap,
  abortChat, listGatewaySessions, deleteSession, patchSession, getSessionUsage, isSessionHidden,
};
