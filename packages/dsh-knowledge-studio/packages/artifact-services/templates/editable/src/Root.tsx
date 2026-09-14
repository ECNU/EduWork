import React from 'react';
import type {CalculateMetadataFunction} from 'remotion';
import {Composition} from 'remotion';
import {EcnuVideo} from './Video';
import {defaultVideoPlan, dimensionsByRatio, getTotalFrames, type VideoPlan} from './types';

const calculateMetadata: CalculateMetadataFunction<VideoPlan> = ({props}) => {
  const dimensions = dimensionsByRatio[props.aspectRatio];
  return {durationInFrames: getTotalFrames(props), fps: props.fps, ...dimensions, props};
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="EcnuVideo"
    component={EcnuVideo}
    durationInFrames={120}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={defaultVideoPlan}
    calculateMetadata={calculateMetadata}
  />
);
