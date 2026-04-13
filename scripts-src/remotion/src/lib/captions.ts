/**
 * SRT parsing and caption word generation for Remotion compositions.
 *
 * Reads SRT files from the cinematic pipeline's narration output and
 * converts them into frame-based word arrays for AnimatedCaption.
 */
import fs from 'fs';

interface SrtEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

interface CaptionWord {
  text: string;
  startFrame: number;
  endFrame: number;
}

export function parseSrt(srtPath: string): SrtEntry[] {
  if (!fs.existsSync(srtPath)) return [];
  const content = fs.readFileSync(srtPath, 'utf-8');
  const blocks = content.trim().split(/\n\n+/);
  const entries: SrtEntry[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;
    const index = parseInt(lines[0], 10);
    const times = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!times) continue;
    const startMs = toMs(times[1], times[2], times[3], times[4]);
    const endMs = toMs(times[5], times[6], times[7], times[8]);
    const text = lines.slice(2).join(' ').trim();
    entries.push({ index, startMs, endMs, text });
  }
  return entries;
}

export function buildCaptionWords(
  entries: SrtEntry[], fps: number, offsetFrames: number,
): CaptionWord[] {
  const words: CaptionWord[] = [];
  for (const entry of entries) {
    const entryWords = entry.text.split(/\s+/).filter(Boolean);
    const entryDurationMs = entry.endMs - entry.startMs;
    const msPerWord = entryDurationMs / Math.max(entryWords.length, 1);

    for (let i = 0; i < entryWords.length; i++) {
      const wordStartMs = entry.startMs + i * msPerWord;
      const wordEndMs = entry.startMs + (i + 1) * msPerWord;
      words.push({
        text: entryWords[i],
        startFrame: offsetFrames + Math.round((wordStartMs / 1000) * fps),
        endFrame: offsetFrames + Math.round((wordEndMs / 1000) * fps),
      });
    }
  }
  return words;
}

function toMs(h: string, m: string, s: string, ms: string): number {
  return parseInt(h) * 3600000 + parseInt(m) * 60000 +
    parseInt(s) * 1000 + parseInt(ms);
}
