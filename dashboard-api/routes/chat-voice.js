// ─── Chat Voice Routes: TTS via ElevenLabs ─────────────────────────
// POST /api/chat/tts — generate speech from text
// POST /api/chat/stt — transcribe audio via local whisper.cpp
// GET  /api/chat/voice-config — return available voices
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const rateLimit = require('express-rate-limit');
const sttUpload = multer({ dest: '/tmp/stt-uploads/', limits: { fileSize: 10 * 1024 * 1024 } });
const WHISPER_URL = process.env.WHISPER_URL || 'http://127.0.0.1:8178';
const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';

const ttsLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Too many TTS requests. Max 10 per minute.' } });
const VOICE_CONFIG_PATH = path.join(CLIENT_ROOT, 'config', 'voice-config.json');

// In-memory TTS cache: hash → { buffer, mime, ts }
const _ttsCache = new Map();
const TTS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const TTS_CACHE_MAX = 50;

function _ttsCacheKey(text, voiceId) {
  return crypto.createHash('md5').update(`${voiceId}:${text}`).digest('hex');
}

function _ttsCacheCleanup() {
  const now = Date.now();
  for (const [key, entry] of _ttsCache) {
    if (now - entry.ts > TTS_CACHE_TTL) _ttsCache.delete(key);
  }
  // Evict oldest if over max
  while (_ttsCache.size > TTS_CACHE_MAX) {
    const oldest = _ttsCache.keys().next().value;
    _ttsCache.delete(oldest);
  }
}

function _loadVoiceConfig() {
  try {
    return JSON.parse(fs.readFileSync(VOICE_CONFIG_PATH, 'utf8'));
  } catch {
    return { default_voice_id: null, voices: [] };
  }
}

module.exports = function registerChatVoiceRoutes(app) {
  const { getSecret } = require('../helpers/secret-loader');
  // GET /api/chat/voice-config
  app.get('/api/chat/voice-config', (req, res) => {
    const config = _loadVoiceConfig();
    let hasKey = false;
    try { hasKey = !!getSecret('ELEVENLABS_API_KEY'); } catch {}
    if (!hasKey) hasKey = !!process.env.ELEVENLABS_API_KEY;
    res.json({
      ttsEnabled: hasKey && !!config.default_voice_id,
      default_voice_id: config.default_voice_id,
      voices: (config.voices || []).map(v => ({
        voice_id: v.voice_id,
        display_name: v.display_name,
        description: v.description,
        gender: v.gender,
        accent: v.accent,
      })),
    });
  });

  // POST /api/chat/tts (rate limited: 10/min)
  app.post('/api/chat/tts', ttsLimiter, async (req, res) => {
    const { text, voiceId: reqVoiceId } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length < 2) {
      return res.status(400).json({ error: 'Text required (min 2 chars)' });
    }

    // Resolve voice ID
    const config = _loadVoiceConfig();
    const voiceId = reqVoiceId || config.default_voice_id;
    if (!voiceId) {
      return res.status(500).json({ error: 'No voice configured. Add a voice in client/config/voice-config.json' });
    }

    // Load API key
    let apiKey;
    try { apiKey = getSecret('ELEVENLABS_API_KEY'); } catch {}
    if (!apiKey) apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'ElevenLabs API key not configured' });
    }

    const trimmed = text.trim().slice(0, 5000);
    const cacheKey = _ttsCacheKey(trimmed, voiceId);

    // Check cache
    _ttsCacheCleanup();
    if (_ttsCache.has(cacheKey)) {
      const entry = _ttsCache.get(cacheKey);
      entry.ts = Date.now(); // refresh TTL
      res.set('Content-Type', entry.mime);
      return res.send(entry.buffer);
    }

    // Call ElevenLabs
    try {
      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: trimmed,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.log(`[chat-voice] ElevenLabs error ${resp.status}: ${errText.slice(0, 200)}`);
        return res.status(resp.status >= 500 ? 502 : resp.status).json({
          error: resp.status === 401 ? 'Invalid ElevenLabs API key' : `TTS failed (${resp.status})`,
        });
      }

      const buffer = Buffer.from(await resp.arrayBuffer());
      const mime = resp.headers.get('content-type') || 'audio/mpeg';

      // Cache result
      _ttsCache.set(cacheKey, { buffer, mime, ts: Date.now() });

      res.set('Content-Type', mime);
      res.send(buffer);
    } catch (e) {
      console.error('[chat-voice] TTS error:', e.message);
      res.status(500).json({ error: 'TTS request failed' });
    }
  });

  // POST /api/chat/stt — transcribe audio via local whisper.cpp server
  app.post('/api/chat/stt', sttUpload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    try {
      // Forward to whisper-server as multipart form (Node 22 native FormData)
      const form = new FormData();
      const audioBuffer = fs.readFileSync(req.file.path);
      form.append('file', new Blob([audioBuffer]), req.file.originalname || 'audio.webm');
      form.append('response_format', 'json');

      const resp = await fetch(`${WHISPER_URL}/inference`, { method: 'POST', body: form });

      // Clean up temp file
      fs.unlink(req.file.path, () => {});

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.log(`[chat-voice] Whisper error ${resp.status}: ${errText.slice(0, 200)}`);
        return res.status(502).json({ error: 'Transcription failed' });
      }

      const result = await resp.json();
      const text = (result.text || '').replace(/\[BLANK_AUDIO\]/g, '').trim();
      res.json({ text });
    } catch (e) {
      console.error('[chat-voice] STT error:', e.message);
      fs.unlink(req.file?.path, () => {});
      res.status(500).json({ error: 'Transcription failed: ' + e.message });
    }
  });

  // GET /api/chat/stt/status — check if whisper server is available
  app.get('/api/chat/stt/status', async (req, res) => {
    try {
      const resp = await fetch(`${WHISPER_URL}/`, { signal: AbortSignal.timeout(2000) });
      res.json({ available: resp.ok });
    } catch {
      res.json({ available: false });
    }
  });
};
