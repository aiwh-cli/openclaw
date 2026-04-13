/**
 * CinematicLandscape — 16:9 composition for YouTube/landscape video.
 *
 * Takes clips from the cinematic pipeline (Veo video, HeyGen presenter,
 * ElevenLabs narration) and composes them with transitions, animated
 * captions, and branded intro/outro sequences.
 */
import React, { useMemo } from 'react';
import {
  AbsoluteFill, Audio, OffthreadVideo, Sequence, useVideoConfig,
  interpolate, staticFile,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { BrandedIntro } from '../components/BrandedIntro';
import { AnimatedCaption } from '../components/AnimatedCaption';
import type { CompositionProps, ClipData } from '../types';
import { parseSrt, buildCaptionWords } from '../lib/captions';

const TRANSITION_FN = {
  crossfade: () => fade(),
  slide: () => slide({ direction: 'from-right' }),
  'fade-black': () => fade(),
  cut: () => fade(),
} as const;

export const CinematicLandscape: React.FC<CompositionProps> = ({
  clips, brand, captions, bgm, transition,
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

  const bg = brand.colors[0] || '#000000';

  return (
    <AbsoluteFill style={{ background: bg }}>
      {/* Branded intro */}
      {introFrames > 0 && (
        <Sequence from={0} durationInFrames={introFrames}>
          <BrandedIntro brand={brand} durationFrames={introFrames} />
        </Sequence>
      )}

      {/* Video clips with transitions */}
      <Sequence from={introFrames}>
        {clips.length > 0 && (
          <TransitionSeries>
            {clips.map((clip, i) => {
              const durFrames = Math.round(clip.durationSec * fps);
              return (
                <React.Fragment key={clip.index}>
                  <TransitionSeries.Sequence durationInFrames={durFrames}>
                    <ClipRenderer clip={clip} />
                  </TransitionSeries.Sequence>
                  {i < clips.length - 1 && transDur > 0 && (
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

      {/* Animated captions overlay */}
      {captions.enabled && captionWords.length > 0 && (
        <AnimatedCaption
          words={captionWords}
          config={captions}
          colors={brand.colors}
        />
      )}

      {/* Background music */}
      {bgm.path && (
        <Audio src={bgm.path} volume={bgm.volume} />
      )}

      {/* Branded outro */}
      {outroFrames > 0 && (
        <Sequence from={introFrames + getTotalClipFrames(clips, fps) - outroFrames}>
          <BrandedIntro
            brand={{ ...brand, introText: brand.outroText }}
            durationFrames={outroFrames}
          />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

const ClipRenderer: React.FC<{ clip: ClipData }> = ({ clip }) => {
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={clip.filePath}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {clip.narrationPath && (
        <Audio src={clip.narrationPath} />
      )}
    </AbsoluteFill>
  );
};

function getTotalClipFrames(clips: ClipData[], fps: number): number {
  return clips.reduce((sum, c) => sum + Math.round(c.durationSec * fps), 0);
}
