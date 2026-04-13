import React from 'react';
import { Composition } from 'remotion';
import { CinematicLandscape } from './compositions/CinematicLandscape';
import { CinematicPortrait } from './compositions/CinematicPortrait';
import { SlidePresentation } from './compositions/SlidePresentation';
import type { CompositionProps, SlideCompositionProps } from './types';

export const Root: React.FC = () => {
  const defaultProps: CompositionProps = {
    clips: [],
    brand: { colors: ['#1a1a2e', '#16213e', '#0f3460', '#e94560'], font: 'Inter', introText: '', outroText: '' },
    captions: { enabled: false, style: 'clean', position: 'bottom', srtPath: '' },
    bgm: { path: '', volume: 0.3 },
    transition: { type: 'crossfade', durationFrames: 15 },
  };

  const slideDefaultProps: SlideCompositionProps = {
    slides: [],
    avatar: {
      videoPath: '', position: 'bottom-right', size: 25, shape: 'circle',
      margin: 30, chromaKey: { color: '#00FF00', similarity: 0.3, smoothness: 0.1 },
    },
    narration: { path: '', durationSec: 0 },
    brand: { colors: ['#0A0A0C', '#16162A', '#C9A84C', '#F0C040'], font: 'Inter', introText: '', outroText: '' },
    captions: { enabled: false, style: 'clean', position: 'bottom', srtPath: '' },
    transition: { type: 'crossfade', durationFrames: 15 },
  };

  return (
    <>
      <Composition
        id="CinematicLandscape"
        component={CinematicLandscape}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultProps}
      />
      <Composition
        id="CinematicPortrait"
        component={CinematicPortrait}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
      />
      <Composition
        id="SlidePresentation"
        component={SlidePresentation}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={slideDefaultProps}
      />
    </>
  );
};
