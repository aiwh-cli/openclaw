/**
 * SlidePresentation — Branded slide deck with avatar overlay.
 *
 * Renders static slide PNGs as full-screen backgrounds with crossfade
 * transitions, a chroma-keyed avatar in the corner, narration audio,
 * and optional animated captions. For educational/explainer content.
 */
import React, { useMemo } from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, useVideoConfig, staticFile,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { BrandedIntro } from '../components/BrandedIntro';
import { AnimatedCaption } from '../components/AnimatedCaption';
import { AvatarOverlay } from '../components/AvatarOverlay';
import type { SlideCompositionProps, SlideData } from '../types';
import { parseSrt, buildCaptionWords } from '../lib/captions';

const TRANSITION_FN = {
  crossfade: () => fade(),
  slide: () => slide({ direction: 'from-right' }),
  'fade-black': () => fade(),
  cut: () => fade(),
} as const;

export const SlidePresentation: React.FC<SlideCompositionProps> = ({
  slides, avatar, narration, brand, captions, transition,
}) => {
  const { fps } = useVideoConfig();
  const introFrames = brand.introText ? Math.round(fps * 3) : 0;
  const outroFrames = brand.outroText ? Math.round(fps * 3) : 0;
  const transDur = transition.type === 'cut' ? 0 : transition.durationFrames;
  const getTransition = TRANSITION_FN[transition.type] || TRANSITION_FN.crossfade;

  const captionWords = useMemo(() => {
    if (!captions.enabled || !captions.srtPath) return [];
    try {
      const entries = parseSrt(captions.srtPath);
      return buildCaptionWords(entries, fps, introFrames);
    } catch { return []; }
  }, [captions, fps, introFrames]);

  const totalSlideFrames = slides.reduce(
    (sum, s) => sum + Math.round(s.durationSec * fps), 0,
  );

  const bg = brand.colors[0] || '#0A0A0C';

  return (
    <AbsoluteFill style={{ background: bg }}>
      {/* Branded intro */}
      {introFrames > 0 && (
        <Sequence from={0} durationInFrames={introFrames}>
          <BrandedIntro brand={brand} durationFrames={introFrames} />
        </Sequence>
      )}

      {/* Slide deck with transitions */}
      <Sequence from={introFrames}>
        {slides.length > 0 && (
          <TransitionSeries>
            {slides.map((sl, i) => {
              const durFrames = Math.round(sl.durationSec * fps);
              return (
                <React.Fragment key={sl.index}>
                  <TransitionSeries.Sequence durationInFrames={durFrames}>
                    <SlideRenderer slide={sl} />
                  </TransitionSeries.Sequence>
                  {i < slides.length - 1 && transDur > 0 && (
                    <TransitionSeries.Transition
                      presentation={getTransition()}
                      timing={linearTiming({ durationInFrames: transDur })}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </TransitionSeries>
        )}
      </Sequence>

      {/* Avatar overlay — positioned in corner with chroma key */}
      {avatar.videoPath && (
        <Sequence from={introFrames} durationInFrames={totalSlideFrames}>
          <AvatarOverlay config={{
            ...avatar,
            videoPath: resolveSrc(avatar.videoPath),
          }} />
        </Sequence>
      )}

      {/* Narration audio */}
      {narration.path && (
        <Sequence from={introFrames}>
          <Audio src={resolveSrc(narration.path)} />
        </Sequence>
      )}

      {/* Animated captions overlay */}
      {captions.enabled && captionWords.length > 0 && (
        <AnimatedCaption
          words={captionWords}
          config={captions}
          colors={brand.colors}
        />
      )}

      {/* Branded outro */}
      {outroFrames > 0 && (
        <Sequence from={introFrames + totalSlideFrames - outroFrames}>
          <BrandedIntro
            brand={{ ...brand, introText: brand.outroText }}
            durationFrames={outroFrames}
          />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

/**
 * Resolve a source path — if it's already a URL, use as-is.
 * Otherwise treat as a publicDir-relative path via staticFile().
 */
function resolveSrc(src: string): string {
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
    return src;
  }
  return staticFile(src);
}

const SlideRenderer: React.FC<{ slide: SlideData }> = ({ slide }) => {
  return (
    <AbsoluteFill>
      <Img
        src={resolveSrc(slide.imagePath)}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </AbsoluteFill>
  );
};
