/** Shared types for Remotion compositions. */

export interface ClipData {
  index: number;
  type: 'cinematic' | 'presenter';
  filePath: string;
  durationSec: number;
  narrationPath?: string;
  narrationDurationSec?: number;
}

export interface BrandConfig {
  colors: string[];
  font: string;
  introText: string;
  outroText: string;
  logoPath?: string;
}

export interface CaptionConfig {
  enabled: boolean;
  style: 'clean' | 'bold' | 'minimal';
  position: 'top' | 'center' | 'bottom';
  srtPath: string;
}

export interface BgmConfig {
  path: string;
  volume: number;
}

export interface TransitionConfig {
  type: 'crossfade' | 'slide' | 'fade-black' | 'cut';
  durationFrames: number;
}

export interface CompositionProps {
  clips: ClipData[];
  brand: BrandConfig;
  captions: CaptionConfig;
  bgm: BgmConfig;
  transition: TransitionConfig;
}

/** Slide presentation types — for educational/explainer videos with avatar overlay. */

export interface SlideData {
  index: number;
  imagePath: string;
  durationSec: number;
}

export interface ChromaKeyConfig {
  color: string;
  similarity: number;
  smoothness: number;
}

export interface AvatarOverlayConfig {
  videoPath: string;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  size: number;
  shape: 'circle' | 'rectangle';
  margin: number;
  chromaKey: ChromaKeyConfig;
}

export interface NarrationConfig {
  path: string;
  durationSec: number;
}

export interface SlideCompositionProps {
  slides: SlideData[];
  avatar: AvatarOverlayConfig;
  narration: NarrationConfig;
  brand: BrandConfig;
  captions: CaptionConfig;
  transition: TransitionConfig;
}
