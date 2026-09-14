import React from 'react';
import {Audio} from '@remotion/media';
import {AbsoluteFill, interpolate, Sequence, staticFile, useVideoConfig} from 'remotion';
import {CaptionBand} from './Captions';
import {SceneVisual} from './templates';
import {getSceneRanges, getTotalFrames, type SceneRange, type VideoPlan} from './types';

const SceneTrack: React.FC<{scene: SceneRange; plan: VideoPlan}> = ({scene, plan}) => {
  const {fps} = useVideoConfig();
  const narration = scene.narration;
  return (
    <AbsoluteFill>
      <SceneVisual scene={scene} plan={plan} />
      {narration ? (
        <Sequence from={narration.fromFrame} durationInFrames={narration.durationInFrames} premountFor={fps}>
          <Audio src={staticFile(narration.src)} volume={narration.volume} />
          {plan.captions?.enabled !== false ? <CaptionBand narration={narration} plan={plan} /> : null}
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

export const EcnuVideo: React.FC<VideoPlan> = (plan) => {
  const {fps} = useVideoConfig();
  const totalFrames = getTotalFrames(plan);
  const ranges = getSceneRanges(plan);
  const legacyNarration = plan.audio?.narration ?? [];
  const bgm = plan.audio?.bgm;
  const narrationWindows = [
    ...ranges.flatMap((scene) => scene.narration ? [{
      src: scene.narration.src,
      volume: scene.narration.volume,
      from: scene.from + scene.narration.fromFrame,
      durationInFrames: scene.narration.durationInFrames,
      embedded: true,
    }] : []),
    ...legacyNarration.map((track) => ({
      src: track.src,
      volume: track.volume,
      from: Math.max(0, Math.round(track.startSeconds * fps)),
      // Version-1 plans explicitly authored a start/end window. Preserve that
      // window for playback and BGM ducking so upgrading the template does not
      // silently change an existing video's timing semantics.
      durationInFrames: Math.max(1, Math.round((track.endSeconds - track.startSeconds) * fps)),
      embedded: false,
    })),
  ];
  return (
    <AbsoluteFill style={{backgroundColor: plan.theme.background}}>
      {ranges.map((scene) => (
        <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames} premountFor={fps}>
          <SceneTrack scene={scene} plan={plan} />
        </Sequence>
      ))}
      {narrationWindows.filter((track) => !track.embedded).map((track) => (
        <Sequence key={`${track.from}-${track.src}`} from={track.from} durationInFrames={track.durationInFrames} premountFor={fps}>
          <Audio src={staticFile(track.src)} volume={track.volume} />
        </Sequence>
      ))}
      {bgm ? <Audio src={staticFile(bgm.src)} loop loopVolumeCurveBehavior="extend" volume={(audioFrame) => {
        const hasNarration = narrationWindows.some((track) => audioFrame >= track.from && audioFrame < track.from + track.durationInFrames);
        const target = hasNarration ? (bgm.duckVolume ?? 0.06) : (bgm.volume ?? 0.16);
        if (totalFrames <= 2) return target;
        const fadeIn = interpolate(audioFrame, [0, fps], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        const fadeOut = interpolate(audioFrame, [Math.max(0, totalFrames - fps), totalFrames - 1], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        return target * Math.min(fadeIn, fadeOut);
      }} /> : null}
    </AbsoluteFill>
  );
};
