export type AspectRatio = '16:9' | '9:16' | '1:1';
export type VideoTemplate = 'editorial' | 'archive-paper' | 'liwa-editorial' | 'digital-pulse' | 'campus-archive';
export type SceneLayout = 'hero' | 'split' | 'full-media' | 'list' | 'stat' | 'quote' | 'timeline' | 'end-card';

export type SceneNarration = {
  /** Exact text sent to TTS. The same text is rendered as the subtitle. */
  text: string;
  src: string;
  volume: number;
  fromFrame: number;
  durationInFrames: number;
  audioDurationSeconds: number;
};

export type ScenePlan = {
  id: string;
  durationSeconds: number;
  durationInFrames: number;
  layout: SceneLayout;
  eyebrow?: string;
  title: string;
  body?: string;
  bullets?: string[];
  stat?: {value: string; label: string};
  media?: {type: 'image'; src: string; fit?: 'cover' | 'contain'; alt?: string};
  narration?: SceneNarration;
};

export type LegacyNarrationTrack = {
  src: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  volume: number;
};

export type VideoPlan = {
  version: 1 | 2;
  id: string;
  title: string;
  aspectRatio: AspectRatio;
  fps: 24 | 25 | 30;
  coverFrame?: number;
  targetDurationSeconds?: number;
  template: VideoTemplate;
  captions?: {enabled: boolean};
  theme: {background: string; foreground: string; accent: string; muted: string};
  scenes: ScenePlan[];
  audio?: {
    /** Kept only so existing version-1 projects still render. */
    narration?: LegacyNarrationTrack[];
    bgm?: {src: string; volume?: number; duckVolume?: number} | null;
  };
};

export const dimensionsByRatio: Record<AspectRatio, {width: number; height: number}> = {
  '16:9': {width: 1920, height: 1080},
  '9:16': {width: 1080, height: 1920},
  '1:1': {width: 1080, height: 1080},
};

export const defaultVideoPlan: VideoPlan = {
  version: 2,
  id: 'new-video',
  title: '新视频',
  aspectRatio: '16:9',
  fps: 30,
  coverFrame: 30,
  template: 'editorial',
  theme: {background: '#fffaf6', foreground: '#201719', accent: '#315c86', muted: '#7b6f72'},
  scenes: [{
    id: 'opening',
    durationSeconds: 4,
    durationInFrames: 120,
    layout: 'hero',
      eyebrow: 'KNOWLEDGE STUDIO',
    title: '从一个清晰的想法开始',
    body: '选择模板和镜头布局，把内容变成有节奏的画面。',
  }],
  audio: {narration: [], bgm: null},
};

export type SceneRange = ScenePlan & {from: number};

export const getSceneRanges = (plan: VideoPlan): SceneRange[] => {
  let cursor = 0;
  return plan.scenes.map((scene) => {
    const durationInFrames = Math.max(
      1,
      Number.isInteger(scene.durationInFrames)
        ? scene.durationInFrames
        : Math.round(scene.durationSeconds * plan.fps),
    );
    const range = {...scene, from: cursor, durationInFrames};
    cursor += durationInFrames;
    return range;
  });
};

export const getTotalFrames = (plan: VideoPlan): number =>
  getSceneRanges(plan).reduce((total, scene) => total + scene.durationInFrames, 0);
