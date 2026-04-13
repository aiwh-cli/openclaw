import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import type { CaptionConfig } from '../types';

interface CaptionWord {
  text: string;
  startFrame: number;
  endFrame: number;
}

interface Props {
  words: CaptionWord[];
  config: CaptionConfig;
  colors: string[];
}

const POSITION_MAP = {
  top: { top: '8%' },
  center: { top: '45%' },
  bottom: { bottom: '10%' },
} as const;

const STYLE_MAP = {
  clean: { bg: 'rgba(0,0,0,0.5)', radius: 8, padding: '8px 16px', fontSize: 28 },
  bold: { bg: 'rgba(0,0,0,0.75)', radius: 12, padding: '12px 24px', fontSize: 36 },
  minimal: { bg: 'transparent', radius: 0, padding: '4px 8px', fontSize: 24 },
} as const;

export const AnimatedCaption: React.FC<Props> = ({ words, config, colors }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pos = POSITION_MAP[config.position];
  const style = STYLE_MAP[config.style];
  const activeColor = colors[3] || '#e94560';

  const visibleWords = useMemo(
    () => words.filter((w) => w.startFrame <= frame && w.endFrame >= frame),
    [words, frame],
  );

  if (visibleWords.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute', left: 0, right: 0,
        display: 'flex', justifyContent: 'center',
        ...pos,
      }}
    >
      <div
        style={{
          background: style.bg, borderRadius: style.radius,
          padding: style.padding, display: 'flex', flexWrap: 'wrap',
          gap: '6px', justifyContent: 'center', maxWidth: '80%',
        }}
      >
        {visibleWords.map((word, i) => {
          const progress = spring({ frame: frame - word.startFrame, fps, durationInFrames: 8 });
          const scale = interpolate(progress, [0, 1], [0.8, 1]);
          const opacity = interpolate(progress, [0, 1], [0.3, 1]);
          const isActive = frame >= word.startFrame && frame < word.startFrame + 10;

          return (
            <span
              key={`${word.text}-${i}`}
              style={{
                color: isActive ? activeColor : '#ffffff',
                fontSize: style.fontSize, fontFamily: 'Inter, sans-serif',
                fontWeight: isActive ? 700 : 500,
                transform: `scale(${scale})`, opacity,
                transition: 'color 0.1s',
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
