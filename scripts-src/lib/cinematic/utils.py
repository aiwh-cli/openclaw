"""Utility functions for the cinematic pipeline.

Includes: prompt sanitization, SRT/ASS generation, timestamp formatting,
cost logging, HTTP helpers, file download, LLM wrapper, realism boost.
"""

import base64
import json
import os
import re
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from cinematic.config import (
    CLIENT_ROOT, PROMPT_SANITIZE_RULES, FFPROBE,
)


# ── LLM provider (imported lazily to avoid circular deps) ────────

def _get_llm():
    """Lazy import of llm_provider functions."""
    from llm_provider import llm_call, get_provider_and_model
    return llm_call, get_provider_and_model


def claude_chat(prompt, model=None, temperature=1.0, max_tokens=8000,
                images=None):
    """Call LLM via provider abstraction. Returns text content or None."""
    llm_call, _ = _get_llm()
    return llm_call(
        prompt, model=None, max_tokens=max_tokens,
        temperature=temperature, images=images,
        timeout=300, retries=3,
    )


# ── Timestamps ───────────────────────────────────────────────────

def now_iso():
    """Return current UTC timestamp in ISO format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Prompt sanitization ─────────────────────────────────────────

def sanitize_prompt(prompt):
    """Remove/replace terms that trigger Google Vertex AI safety filters."""
    original = prompt
    for pattern, replacement in PROMPT_SANITIZE_RULES:
        prompt = re.sub(pattern, replacement, prompt, flags=re.IGNORECASE)
    if prompt != original:
        print("    Prompt sanitized (safety filter)")
    return prompt


# ── Realism boost ────────────────────────────────────────────────

PERSON_KEYWORDS = [
    'person', 'people', 'man', 'woman', 'human', 'face', 'presenter',
    'avatar', 'character', 'figure', 'hand', 'portrait', 'coach',
    'entrepreneur', 'professional', 'client', 'speaker',
]


def realism_boost(prompt, clip):
    """Inject hyper-realism skin texture directives for clips with people."""
    desc_lower = (clip.get('description', '') + ' ' + prompt).lower()
    has_person = any(w in desc_lower for w in PERSON_KEYWORDS)
    if has_person:
        prompt += (
            " Hyper-realistic skin texture with visible pores, fine wrinkles, "
            "natural blemishes, subsurface scattering, peach fuzz, real human "
            "skin imperfections. Shot on Arri Alexa Mini LF, Cooke S7/i lens."
        )
    return prompt, has_person


# ── HTTP helpers ─────────────────────────────────────────────────

def api_call(url, data=None, headers=None, method="POST", retries=3):
    """Make an HTTP API call with retry on transient errors."""
    body = json.dumps(data).encode() if data else None
    for attempt in range(retries):
        req = urllib.request.Request(
            url, data=body, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            if e.code in (429, 503, 500) and attempt < retries - 1:
                wait = (attempt + 1) * 10
                print(f"  HTTP {e.code} -- retrying in {wait}s "
                      f"(attempt {attempt+1}/{retries})")
                time.sleep(wait)
                continue
            print(f"  HTTP {e.code}: {err[:500]}")
            return None
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                wait = (attempt + 1) * 10
                print(f"  Network error -- retrying in {wait}s: {e}")
                time.sleep(wait)
                continue
            print(f"  Network error (giving up): {e}")
            return None


def download_file(url, dest):
    """Download a URL to local path. Returns True on success."""
    urllib.request.urlretrieve(url, str(dest))
    return os.path.exists(dest) and os.path.getsize(dest) > 0


# ── Cost logging ─────────────────────────────────────────────────

def log_cost(service, model, cost_usd, detail=""):
    """Append cost entry to cinematic cost ledger + cost-monitor.log."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ledger = Path(CLIENT_ROOT + "/logs/cinematic-costs.jsonl")
    entry = json.dumps({
        "timestamp": now_iso(),
        "date": datetime.now().strftime("%Y-%m-%d"),
        "service": service, "model": model,
        "cost_usd": round(cost_usd, 4),
        "detail": detail
    })
    with open(ledger, "a") as f:
        f.write(entry + "\n")
    log_line = (f"[{ts}] Cinematic: ${cost_usd:.4f} "
                f"({service}/{model}) {detail}\n")
    with open(CLIENT_ROOT + "/logs/cost-monitor.log", "a") as f:
        f.write(log_line)


# ── Media duration ───────────────────────────────────────────────

def get_duration(filepath):
    """Get media duration in seconds via ffprobe."""
    import subprocess
    try:
        result = subprocess.run(
            [FFPROBE, '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', str(filepath)],
            capture_output=True, text=True, timeout=30
        )
        return float(result.stdout.strip())
    except Exception:
        return 0


# ── SRT / ASS generation ────────────────────────────────────────

def chars_to_words(chars, starts, ends):
    """Group characters into words with start/end times."""
    words = []
    current_word = ""
    word_start = 0
    word_end = 0

    for i, ch in enumerate(chars):
        if ch == " " or ch == "\n":
            if current_word:
                words.append({
                    "word": current_word,
                    "start": word_start, "end": word_end
                })
                current_word = ""
        else:
            if not current_word:
                word_start = starts[i] if i < len(starts) else word_end
            current_word += ch
            word_end = ends[i] if i < len(ends) else word_start + 0.1

    if current_word:
        words.append({
            "word": current_word,
            "start": word_start, "end": word_end
        })
    return words


def format_srt_time(seconds):
    """Format seconds as SRT timestamp: HH:MM:SS,mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(words, srt_path, words_per_segment=6):
    """Write SRT file from word-level timestamps."""
    segments = []
    for i in range(0, len(words), words_per_segment):
        group = words[i:i + words_per_segment]
        text = " ".join(w["word"] for w in group)
        start = group[0]["start"]
        end = group[-1]["end"]
        segments.append((start, end, text))

    with open(srt_path, 'w') as f:
        for idx, (start, end, text) in enumerate(segments, 1):
            f.write(f"{idx}\n")
            f.write(f"{format_srt_time(start)} --> {format_srt_time(end)}\n")
            f.write(f"{text}\n\n")


def parse_srt_time(ts):
    """Parse SRT timestamp to seconds."""
    parts = ts.replace(',', '.').split(':')
    return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])


def combine_clip_srts(narr_dir, assembled, output_dir):
    """Combine per-clip SRT files into one full SRT with adjusted timestamps."""
    full_srt = output_dir / "captions-full.srt"
    entries = []
    time_offset = 0.0
    seq = 1

    for idx, clip_path, has_audio in assembled:
        srt_file = narr_dir / f"clip-{idx+1:02d}-narration.srt"
        clip_dur = get_duration(clip_path) or 6.0

        if srt_file.exists():
            with open(srt_file) as f:
                content = f.read()
            blocks = re.split(r'\n\n+', content.strip())
            for block in blocks:
                lines = block.strip().split('\n')
                if len(lines) >= 3:
                    ts_match = re.match(
                        r'(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)',
                        lines[1])
                    if ts_match:
                        start = parse_srt_time(ts_match.group(1)) + time_offset
                        end = parse_srt_time(ts_match.group(2)) + time_offset
                        text = '\n'.join(lines[2:])
                        entries.append((seq, start, end, text))
                        seq += 1

        time_offset += clip_dur

    if not entries:
        return None

    with open(full_srt, 'w') as f:
        for seq_num, start, end, text in entries:
            f.write(f"{seq_num}\n")
            f.write(f"{format_srt_time(start)} --> {format_srt_time(end)}\n")
            f.write(f"{text}\n\n")

    return str(full_srt)


def get_ass_style(position, style, fmt):
    """Generate ASS style definition based on preferences and output format."""
    aspect = fmt.get('aspect', '16:9')

    alignment_map = {'bottom': 2, 'center': 5, 'top': 8}
    alignment = alignment_map.get(position, 2)

    height = fmt.get('height', 720)
    base_size = max(18, height // 30)
    if aspect == '9:16':
        base_size = max(16, height // 45)

    margins = {
        '9:16': {'bottom': 80, 'center': 30, 'top': 60},
        '16:9': {'bottom': 40, 'center': 20, 'top': 30},
        '1:1':  {'bottom': 40, 'center': 20, 'top': 30},
    }
    fmt_margins = margins.get(aspect, margins['16:9'])
    margin_bottom = fmt_margins.get(position, 30)

    if style == 'bold':
        return {
            'fontname': 'Arial', 'fontsize': int(base_size * 1.3),
            'primarycolour': '&H0000D7FF',
            'outlinecolour': '&H00000000', 'outline': 3, 'shadow': 2,
            'bold': -1, 'alignment': alignment,
            'marginv': margin_bottom
        }
    elif style == 'minimal':
        return {
            'fontname': 'Arial', 'fontsize': base_size,
            'primarycolour': '&H00FFFFFF',
            'backcolour': '&H80000000',
            'outlinecolour': '&H00000000', 'outline': 0, 'shadow': 0,
            'bold': 0, 'alignment': alignment, 'borderstyle': 3,
            'marginv': margin_bottom
        }
    else:  # clean
        return {
            'fontname': 'Arial', 'fontsize': base_size,
            'primarycolour': '&H00FFFFFF',
            'outlinecolour': '&H00000000', 'outline': 2, 'shadow': 1,
            'bold': 0, 'alignment': alignment,
            'marginv': margin_bottom
        }


def srt_to_ass(srt_path, ass_path, style):
    """Convert SRT to ASS format with styled subtitles."""
    with open(srt_path) as f:
        content = f.read()

    blocks = re.split(r'\n\n+', content.strip())
    events = []

    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) >= 3:
            ts_match = re.match(
                r'(\d+:\d+:\d+),(\d+)\s*-->\s*(\d+:\d+:\d+),(\d+)',
                lines[1])
            if ts_match:
                start = f"{ts_match.group(1)}.{ts_match.group(2)[:2]}"
                end = f"{ts_match.group(3)}.{ts_match.group(4)[:2]}"
                text = '\\N'.join(lines[2:])
                events.append(
                    f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")

    border_style = style.get('borderstyle', 1)
    with open(ass_path, 'w') as f:
        f.write("[Script Info]\nScriptType: v4.00+\n"
                "PlayResX: 1280\nPlayResY: 720\n\n")
        f.write("[V4+ Styles]\nFormat: Name, Fontname, Fontsize, "
                "PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
                "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, "
                "Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
                "MarginL, MarginR, MarginV, Encoding\n")
        f.write(
            f"Style: Default,{style['fontname']},{style['fontsize']},"
            f"{style['primarycolour']},&H000000FF,"
            f"{style.get('outlinecolour', '&H00000000')},"
            f"{style.get('backcolour', '&H00000000')},"
            f"{style.get('bold', 0)},0,0,0,100,100,0,0,"
            f"{border_style},{style.get('outline', 2)},"
            f"{style.get('shadow', 1)},"
            f"{style['alignment']},20,20,"
            f"{style.get('marginv', 35)},1\n\n")
        f.write("[Events]\nFormat: Layer, Start, End, Style, Name, "
                "MarginL, MarginR, MarginV, Effect, Text\n")
        for evt in events:
            f.write(evt + "\n")


def parse_json_response(text):
    """Parse JSON from LLM response, stripping markdown fences if present."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
    return json.loads(cleaned)
