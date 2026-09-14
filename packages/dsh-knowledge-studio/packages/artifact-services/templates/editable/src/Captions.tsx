import React, {useMemo} from 'react';
import type {Caption} from '@remotion/captions';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneNarration, VideoPlan} from './types';

export const CaptionBand: React.FC<{narration: SceneNarration; plan: VideoPlan}> = ({narration, plan}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const base = Math.min(width, height);
  const caption = useMemo<Caption>(() => ({
    text: narration.text,
    startMs: 0,
    endMs: narration.audioDurationSeconds * 1000,
    timestampMs: null,
    confidence: null,
  }), [narration.audioDurationSeconds, narration.text]);
  const durationInFrames = Math.max(1, narration.durationInFrames);
  const fadeFrames = Math.min(Math.max(2, Math.round(fps * 0.12)), Math.max(1, durationInFrames - 1));
  const opacity = durationInFrames === 1
    ? 1
    : Math.min(
      interpolate(frame, [0, fadeFrames], [0.4, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
      interpolate(frame, [Math.max(0, durationInFrames - fadeFrames - 1), durationInFrames - 1], [1, 0.45], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
    );
  const vertical = plan.aspectRatio === '9:16';
  const bottomSafe = vertical
    ? Math.max(260, Math.round(height * 0.146))
    : Math.max(100, Math.round(height * 0.07));
  const horizontalSafe = vertical
    ? Math.max(180, Math.round(width * 0.167))
    : Math.max(96, Math.round(width * 0.06));
  const background = (plan.template === 'archive-paper' || plan.template === 'campus-archive')
    ? '#2b211ae8'
    : plan.template === 'digital-pulse'
      ? `${plan.theme.foreground}ee`
      : '#201719e8';
  return (
    <AbsoluteFill style={{alignItems: 'center', boxSizing: 'border-box', justifyContent: 'flex-end', padding: `0 ${horizontalSafe}px ${bottomSafe}px`, pointerEvents: 'none'}}>
      <div style={{background, borderLeft: `${Math.max(6, base * 0.009)}px solid ${plan.theme.accent}`, boxShadow: `0 ${base * 0.012}px ${base * 0.04}px #00000025`, color: '#fff', fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif', fontSize: Math.max(44, base * 0.041), fontWeight: 650, lineHeight: 1.42, maxWidth: vertical ? '100%' : '82%', opacity, overflowWrap: 'break-word', padding: `${base * 0.018}px ${base * 0.032}px`, textAlign: 'center', whiteSpace: 'pre-wrap'}}>
        {caption.text}
      </div>
    </AbsoluteFill>
  );
};
