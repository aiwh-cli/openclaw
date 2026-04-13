import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Img } from 'remotion';
import type { BrandConfig } from '../types';

interface Props {
  brand: BrandConfig;
  durationFrames: number;
}

export const BrandedIntro: React.FC<Props> = ({ brand, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const fadeIn = spring({ frame, fps, durationInFrames: 20 });
  const fadeOut = interpolate(frame, [durationFrames - 15, durationFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const opacity = Math.min(fadeIn, fadeOut);
  const titleY = interpolate(fadeIn, [0, 1], [40, 0]);

  const bg1 = brand.colors[0] || '#1a1a2e';
  const bg2 = brand.colors[1] || '#16213e';
  const accent = brand.colors[3] || '#e94560';

  return (
    <div
      style={{
        width, height, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        background: `linear-gradient(135deg, ${bg1}, ${bg2})`,
        opacity,
      }}
    >
      {brand.logoPath && (
        <Img
          src={brand.logoPath}
          style={{ width: 120, height: 120, marginBottom: 24, borderRadius: 16 }}
        />
      )}
      {brand.introText && (
        <div
          style={{
            color: '#ffffff', fontSize: 48, fontWeight: 700,
            fontFamily: `${brand.font}, Inter, sans-serif`,
            textAlign: 'center', maxWidth: '70%',
            transform: `translateY(${titleY}px)`,
          }}
        >
          {brand.introText}
        </div>
      )}
      <div
        style={{
          width: 60, height: 3, background: accent,
          marginTop: 20, borderRadius: 2,
          transform: `scaleX(${fadeIn})`, transformOrigin: 'center',
        }}
      />
    </div>
  );
};
