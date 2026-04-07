// ─── Chat View: Voice Input (STT) & Voice Replies (TTS) ────────────
// Web Speech API for speech-to-text, ElevenLabs for text-to-speech.
// Reference: OpenClaw's ui/src/ui/chat/speech.ts
// Globals provided: _chatSttInit, _chatToggleMic, _chatRequestTts

let _chatSttActive = false;
let _chatSttMediaRecorder = null;
let _chatSttChunks = [];
let _chatSttAvailable = false;
let _chatSttStream = null; // persistent mic stream — avoids getUserMedia delay on each press
let _chatTtsAudio = null;
let _chatTtsCache = new Map();
let _chatTtsEnabled = false;

// ─── Init checks ────────────────────────────────────────────

async function _chatTtsInit() {
  try {
    const config = await api('/chat/voice-config');
    _chatTtsEnabled = config?.ttsEnabled === true;
  } catch { _chatTtsEnabled = false; }
}

async function _chatSttInit() {
  const btn = document.getElementById('chat-mic-btn');
  if (!btn) {return;}
  try {
    const status = await api('/chat/stt/status');
    _chatSttAvailable = status?.available === true;
  } catch { _chatSttAvailable = false; }
  if (_chatSttAvailable) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

// ─── STT (Speech-to-Text via local Whisper) ─────────────────

function _chatToggleMic() {
  if (_chatSttActive) {
    _chatStopStt();
  } else {
    _chatStartStt();
  }
}

async function _chatEnsureMicStream() {
  if (_chatSttStream && _chatSttStream.active) {return _chatSttStream;}
  _chatSttStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return _chatSttStream;
}

async function _chatStartStt() {
  const btn = document.getElementById('chat-mic-btn');
  try {
    const stream = await _chatEnsureMicStream();
    _chatSttChunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {_chatSttChunks.push(e.data);}
    };

    recorder.onstop = async () => {
      // Don't stop tracks — keep stream alive for next recording
      if (_chatSttChunks.length === 0) {return;}

      const blob = new Blob(_chatSttChunks, { type: 'audio/webm' });
      _chatSttChunks = [];

      // Show transcribing state
      if (btn) {btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1a2.5 2.5 0 00-2.5 2.5v4a2.5 2.5 0 005 0v-4A2.5 2.5 0 008 1z" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 7v.5a4.5 4.5 0 009 0V7M8 12v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';}
      btn?.classList.add('transcribing');

      // Send to local whisper server via dashboard proxy
      const form = new FormData();
      form.append('audio', blob, 'recording.webm');

      try {
        const res = await fetch('/api/chat/stt', { method: 'POST', body: form });
        const data = await res.json();
        if (data.text) {
          const textarea = document.getElementById('chat-input');
          if (textarea) {
            textarea.value = (textarea.value ? textarea.value.trimEnd() + ' ' : '') + data.text;
            if (typeof _chatAutoResize === 'function') {_chatAutoResize(textarea);}
            textarea.focus();
          }
        } else if (data.error) {
          showToast('Transcription: ' + data.error, 'error');
        }
      } catch (e) {
        showToast('Transcription failed: ' + e.message, 'error');
      }

      if (btn) {
        btn.classList.remove('transcribing', 'recording');
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1a2.5 2.5 0 00-2.5 2.5v4a2.5 2.5 0 005 0v-4A2.5 2.5 0 008 1z" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 7v.5a4.5 4.5 0 009 0V7M8 12v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
      }
    };

    recorder.start();
    _chatSttMediaRecorder = recorder;
    _chatSttActive = true;
    if (btn) {btn.classList.add('recording');}
  } catch (e) {
    showToast('Microphone access denied or unavailable', 'error');
    console.log('[chat-voice] getUserMedia error:', e.message);
  }
}

function _chatStopStt() {
  _chatSttActive = false;
  if (_chatSttMediaRecorder && _chatSttMediaRecorder.state !== 'inactive') {
    _chatSttMediaRecorder.stop();
  }
  _chatSttMediaRecorder = null;
}

// ─── TTS (Text-to-Speech) ──────────────────────────────────

function _stripMarkdownForTts(text) {
  return text
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/`[^`]+`/g, '')        // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
    .replace(/[*_~#>|=-]+/g, '')    // markdown chars
    .replace(/\n{2,}/g, '. ')       // paragraph breaks → pause
    .replace(/\n/g, ' ')            // newlines → spaces
    .trim();
}

function _chatTtsCacheKey(text, voiceId) {
  // Simple hash for cache key
  let hash = 0;
  const s = (voiceId || '') + ':' + text;
  for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0; }
  return 'tts-' + Math.abs(hash).toString(36);
}

const _TTS_COST_PER_CHAR = 0.30 / 1000; // ElevenLabs Turbo v2.5: ~$0.30/1000 chars
const _PLAY_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 2l10 6-10 6V2z" fill="currentColor"/></svg>';
const _PAUSE_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="4" height="12" rx="1" fill="currentColor"/><rect x="9" y="2" width="4" height="12" rx="1" fill="currentColor"/></svg>';

function _chatTtsCostEstimate(charCount) {
  const cost = charCount * _TTS_COST_PER_CHAR;
  return cost < 0.005 ? '<$0.01' : '~$' + cost.toFixed(2);
}

async function _chatRequestTts(messageEl) {
  const bubble = messageEl.closest('.chat-group-messages')?.querySelector('.chat-bubble');
  if (!bubble) {return;}
  const rawText = bubble.textContent?.trim();
  if (!rawText) {return;}

  const text = _stripMarkdownForTts(rawText);
  if (!text || text.length < 3) {return;}

  const btn = messageEl;
  const cacheKey = _chatTtsCacheKey(text);

  // If this button's audio is currently playing — toggle pause/resume
  if (_chatTtsAudio && btn.dataset.cacheKey === cacheKey) {
    if (_chatTtsAudio.paused) {
      _chatTtsAudio.play();
      btn.classList.add('playing');
      btn.innerHTML = `${_PAUSE_ICON} Pause`;
    } else {
      _chatTtsAudio.pause();
      btn.classList.remove('playing');
      btn.innerHTML = `${_PLAY_ICON} Resume`;
    }
    return;
  }

  // Stop any other playing audio first
  _chatStopAudio();

  // Check cache — play immediately, no API call
  if (_chatTtsCache.has(cacheKey)) {
    _chatPlayAudio(_chatTtsCache.get(cacheKey), btn, cacheKey);
    return;
  }

  // Truncate very long text (ElevenLabs limit)
  const truncated = text.length > 4500 ? text.slice(0, 4500) + '...' : text;

  btn.classList.add('playing');
  btn.innerHTML = `${_PAUSE_ICON} Loading...`;

  try {
    const res = await fetch('/api/chat/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: truncated }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'TTS failed', 'error');
      _chatResetListenBtn(btn, text);
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    _chatTtsCache.set(cacheKey, url);

    if (_chatTtsCache.size > 50) {
      const oldest = _chatTtsCache.keys().next().value;
      URL.revokeObjectURL(_chatTtsCache.get(oldest));
      _chatTtsCache.delete(oldest);
    }

    _chatPlayAudio(url, btn, cacheKey);
  } catch (e) {
    showToast('TTS error: ' + e.message, 'error');
    _chatResetListenBtn(btn, text);
  }
}

function _chatPlayAudio(url, btn, cacheKey) {
  _chatStopAudio();

  const audio = new Audio(url);
  _chatTtsAudio = audio;
  if (btn) {
    btn.dataset.cacheKey = cacheKey;
    btn.classList.add('playing');
    btn.innerHTML = `${_PAUSE_ICON} Pause`;
  }

  audio.onended = () => {
    _chatTtsAudio = null;
    if (btn) {
      btn.dataset.cacheKey = '';
      const text = btn.closest('.chat-group-messages')?.querySelector('.chat-bubble')?.textContent?.trim() || '';
      _chatResetListenBtn(btn, text);
    }
  };

  audio.play().catch(e => {
    console.log('[chat-voice] Audio play failed:', e.message);
    _chatTtsAudio = null;
    if (btn) {
      const text = btn.closest('.chat-group-messages')?.querySelector('.chat-bubble')?.textContent?.trim() || '';
      _chatResetListenBtn(btn, text);
    }
  });
}

function _chatStopAudio() {
  if (_chatTtsAudio) {
    _chatTtsAudio.pause();
    _chatTtsAudio = null;
  }
  document.querySelectorAll('.chat-listen-btn.playing').forEach(b => {
    b.classList.remove('playing');
    b.dataset.cacheKey = '';
    const text = b.closest('.chat-group-messages')?.querySelector('.chat-bubble')?.textContent?.trim() || '';
    _chatResetListenBtn(b, text);
  });
}

function _chatResetListenBtn(btn, rawText) {
  btn.classList.remove('playing');
  btn.dataset.cacheKey = '';
  const cleaned = _stripMarkdownForTts(rawText || '');
  const cost = cleaned.length > 10 ? ` (${_chatTtsCostEstimate(cleaned.length)})` : '';
  btn.innerHTML = `${_PLAY_ICON} Listen${cost}`;
}
