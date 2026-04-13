/**
 * AvatarOverlay — Renders avatar video in a corner of the frame.
 *
 * Supports two modes:
 * 1. Transparent WebM (alpha channel) — set transparent: true in config
 * 2. Opaque video in a styled frame (circle/rectangle with border)
 *
 * For transparent mode, pre-process with FFmpeg:
 *   ffmpeg -i avatar.mp4 -vf "chromakey=0x00FF00:0.3:0.1" \
 *     -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 avatar-alpha.webm
 */
import React from 'react';
import { OffthreadVideo, useVideoConfig } from 'remotion';
import type { AvatarOverlayConfig } from '../types';

interface Props {
  config: AvatarOverlayConfig;
}

const POSITION_STYLES: Record<string, React.CSSProperties> = {
  'bottom-right': { bottom: 0, right: 0 },
  'bottom-left': { bottom: 0, left: 0 },
  'top-right': { top: 0, right: 0 },
  'top-left': { top: 0, left: 0 },
};

export const AvatarOverlay: React.FC<Props> = ({ config }) => {
  const { height: vh } = useVideoConfig();

  // Use viewport height for both dimensions to ensure a perfect square/circle
  const avatarSize = Math.round(vh * (config.size / 100));
  const pos = POSITION_STYLES[config.position] || POSITION_STYLES['bottom-right'];
  const isCircle = config.shape === 'circle';
  const borderRadius = isCircle ? '50%' : '16px';
  const isTransparent = config.videoPath.endsWith('.webm');

  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        margin: config.margin,
        width: avatarSize,
        height: avatarSize,
        overflow: 'hidden',
        borderRadius,
        pointerEvents: 'none',
        border: isTransparent ? 'none' : '3px solid rgba(201, 168, 76, 0.6)',
        boxShadow: isTransparent ? 'none' : '0 4px 20px rgba(0, 0, 0, 0.5)',
      }}
    >
      <OffthreadVideo
        src={config.videoPath}
        transparent={isTransparent}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </div>
  );
};
