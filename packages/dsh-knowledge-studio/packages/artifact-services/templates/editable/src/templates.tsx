import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {ScenePlan, VideoPlan, VideoTemplate} from './types';

type Design = {
  font: string;
  heading: string;
  surface: string;
  secondary: string;
  border: string;
};

const designFor = (template: VideoTemplate, plan: VideoPlan): Design => {
  if (template === 'digital-pulse') {
    return {
      font: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
      heading: 'Arial Black, "Microsoft YaHei", sans-serif',
      surface: '#ffffffdc',
      secondary: '#f3c742',
      border: `${plan.theme.foreground}28`,
    };
  }
  if (template === 'archive-paper' || template === 'campus-archive') {
    return {
      font: '"Microsoft YaHei", "PingFang SC", sans-serif',
      heading: 'Georgia, "STSong", "Songti SC", serif',
      surface: '#fffaf0d9',
      secondary: '#657153',
      border: `${plan.theme.foreground}2e`,
    };
  }
  return {
    font: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    heading: '"Microsoft YaHei", "PingFang SC", sans-serif',
    surface: '#ffffffd9',
    secondary: '#d9ab5f',
    border: `${plan.theme.accent}30`,
  };
};

const balancedTextStyle = {
  overflowWrap: 'break-word',
  textWrap: 'balance',
} as React.CSSProperties;

const keepLastChinesePair = (text: string): React.ReactNode => {
  const characters = Array.from(text);
  if (characters.length < 4 || /\s/.test(text)) return text;
  return (
    <>
      {characters.slice(0, -2).join('')}
      <span style={{whiteSpace: 'nowrap'}}>{characters.slice(-2).join('')}</span>
    </>
  );
};

const TemplateBackdrop: React.FC<{plan: VideoPlan}> = ({plan}) => {
  const {width, height} = useVideoConfig();
  const base = Math.min(width, height);
  if (plan.template === 'digital-pulse') {
    return (
      <AbsoluteFill style={{
        backgroundColor: plan.theme.background,
        backgroundImage: `linear-gradient(${plan.theme.foreground}10 2px, transparent 2px), linear-gradient(90deg, ${plan.theme.foreground}10 2px, transparent 2px)`,
        backgroundSize: `${base * 0.065}px ${base * 0.065}px`,
      }}>
        <div style={{position: 'absolute', right: -base * 0.12, top: -base * 0.28, width: base * 0.72, height: base * 1.15, background: plan.theme.accent, transform: 'rotate(16deg)', opacity: 0.12}} />
        <div style={{position: 'absolute', left: 0, top: 0, width: base * 0.025, height: '100%', background: plan.theme.accent}} />
        <div style={{position: 'absolute', left: base * 0.055, right: base * 0.055, top: base * 0.045, height: base * 0.009, background: `linear-gradient(90deg, ${plan.theme.accent} 0 24%, #f3c742 24% 38%, ${plan.theme.foreground} 38% 100%)`}} />
      </AbsoluteFill>
    );
  }
  if ((plan.template === 'archive-paper' || plan.template === 'campus-archive')) {
    return (
      <AbsoluteFill style={{
        backgroundColor: plan.theme.background,
        backgroundImage: `repeating-linear-gradient(0deg, transparent 0 ${base * 0.018}px, ${plan.theme.foreground}0b ${base * 0.018}px ${base * 0.019}px)`,
      }}>
        <div style={{position: 'absolute', inset: base * 0.035, border: `${Math.max(2, base * 0.002)}px solid ${plan.theme.foreground}24`}} />
        <div style={{position: 'absolute', left: base * 0.075, top: 0, bottom: 0, width: Math.max(2, base * 0.002), background: `${plan.theme.accent}30`}} />
        <div style={{position: 'absolute', right: base * 0.07, top: base * 0.06, width: base * 0.18, height: base * 0.045, background: '#d8bd8290', transform: 'rotate(3deg)'}} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{backgroundColor: plan.theme.background}}>
      <div style={{position: 'absolute', inset: 0, background: `radial-gradient(circle at 82% 18%, ${plan.theme.accent}24 0, transparent 34%), radial-gradient(circle at 14% 86%, ${plan.theme.accent}16 0, transparent 30%)`}} />
      <div style={{position: 'absolute', width: base * 0.64, height: base * 0.64, border: `${base * 0.018}px solid ${plan.theme.accent}0d`, borderRadius: '50%', right: -base * 0.19, bottom: -base * 0.22}} />
      <div style={{position: 'absolute', left: base * 0.06, top: base * 0.06, width: base * 0.055, height: base * 0.012, borderRadius: base, background: plan.theme.accent}} />
    </AbsoluteFill>
  );
};

const MediaPanel: React.FC<{scene: ScenePlan; plan: VideoPlan; compact?: boolean}> = ({scene, plan, compact = false}) => {
  const {width, height} = useVideoConfig();
  const base = Math.min(width, height);
  const design = designFor(plan.template, plan);
  if (!scene.media) {
    return (
      <div style={{alignItems: 'center', background: plan.template === 'digital-pulse' ? plan.theme.foreground : design.surface, border: `${Math.max(2, base * 0.002)}px solid ${design.border}`, color: plan.template === 'digital-pulse' ? '#fff' : plan.theme.accent, display: 'flex', flex: 1, justifyContent: 'center', minHeight: compact ? base * 0.25 : base * 0.42, overflow: 'hidden', position: 'relative'}}>
        <div style={{fontFamily: design.heading, fontSize: base * 0.22, fontWeight: 900, lineHeight: 1, opacity: 0.92}}>E</div>
        <div style={{position: 'absolute', bottom: base * 0.035, fontFamily: design.font, fontSize: Math.max(28, base * 0.026), fontWeight: 700, letterSpacing: '0.16em'}}>EAST CHINA NORMAL UNIVERSITY</div>
      </div>
    );
  }
  return (
    <div style={{backgroundColor: design.surface, border: `${Math.max(2, base * 0.002)}px solid ${design.border}`, boxShadow: (plan.template === 'archive-paper' || plan.template === 'campus-archive') ? `${base * 0.016}px ${base * 0.018}px 0 ${plan.theme.foreground}12` : `0 ${base * 0.025}px ${base * 0.07}px #20171920`, display: 'flex', flex: 1, justifyContent: 'center', minHeight: compact ? base * 0.25 : base * 0.42, overflow: 'hidden', padding: (plan.template === 'archive-paper' || plan.template === 'campus-archive') ? base * 0.018 : 0, transform: (plan.template === 'archive-paper' || plan.template === 'campus-archive') ? 'rotate(0.7deg)' : undefined}}>
      <Img src={staticFile(scene.media.src)} style={{height: '100%', objectFit: scene.media.fit ?? 'cover', width: '100%'}} />
    </div>
  );
};

const Header: React.FC<{scene: ScenePlan; plan: VideoPlan; base: number}> = ({scene, plan, base}) => {
  const design = designFor(plan.template, plan);
  return scene.eyebrow ? (
    <div style={{alignItems: 'center', color: plan.theme.accent, display: 'flex', fontFamily: design.font, fontSize: Math.max(32, base * 0.03), fontWeight: 800, gap: base * 0.018, letterSpacing: '0.12em'}}>
      <span style={{display: 'inline-block', height: base * 0.012, width: base * 0.055, background: plan.theme.accent}} />
      {scene.eyebrow}
    </div>
  ) : null;
};

const Title: React.FC<{text: string; plan: VideoPlan; base: number; centered?: boolean; large?: boolean}> = ({text, plan, base, centered = false, large = false}) => {
  const design = designFor(plan.template, plan);
  const scale = large ? (plan.aspectRatio === '9:16' ? 0.088 : 0.105) : (plan.aspectRatio === '9:16' ? 0.072 : 0.078);
  const characters = Array.from(text).length;
  const lengthScale = characters > 36 ? 0.84 : characters > 24 ? 0.92 : 1;
  const fontSize = Math.max(84, base * scale * lengthScale);
  const maxWidth = centered
    ? plan.aspectRatio === '9:16'
      ? '100%'
      : large
        ? '88%'
        : '94%'
    : '100%';
  return (
    <div style={{...balancedTextStyle, alignSelf: centered ? 'center' : undefined, fontFamily: design.heading, fontSize, fontWeight: (plan.template === 'archive-paper' || plan.template === 'campus-archive') ? 700 : 850, letterSpacing: plan.template === 'digital-pulse' ? '-0.045em' : '-0.025em', lineHeight: 1.1, maxWidth, textAlign: centered ? 'center' : 'left', width: centered ? '100%' : 'auto'}}>
      {keepLastChinesePair(text)}
    </div>
  );
};

const Body: React.FC<{text?: string; plan: VideoPlan; base: number; centered?: boolean}> = ({text, plan, base, centered = false}) => text ? (
  <div style={{color: plan.theme.muted, fontFamily: designFor(plan.template, plan).font, fontSize: Math.max(44, base * 0.041), fontWeight: 480, lineHeight: 1.45, maxWidth: '100%', textAlign: centered ? 'center' : 'left'}}>{text}</div>
) : null;

export const SceneVisual: React.FC<{scene: ScenePlan; plan: VideoPlan}> = ({scene, plan}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const base = Math.min(width, height);
  const safeX = Math.max(80, Math.round(width * 0.06));
  const safeY = Math.max(100, Math.round(height * 0.07));
  const vertical = plan.aspectRatio === '9:16';
  const safeRight = vertical ? Math.max(140, Math.round(width * 0.13)) : safeX;
  const safeLeft = (plan.template === 'archive-paper' || plan.template === 'campus-archive')
    ? Math.max(safeX, Math.round(base * 0.12))
    : safeX;
  const design = designFor(plan.template, plan);
  const enterFrames = Math.min(Math.max(1, scene.durationInFrames - 1), Math.max(1, Math.round(fps * 0.65)));
  const enterProgress = scene.durationInFrames <= 1
    ? 1
    : interpolate(frame, [0, enterFrames], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)});
  const motionStyle: React.CSSProperties = plan.template === 'digital-pulse'
    ? {
      opacity: 0.3 + enterProgress * 0.7,
      translate: `${(1 - enterProgress) * base * 0.045}px 0`,
    }
    : (plan.template === 'archive-paper' || plan.template === 'campus-archive')
      ? {
        opacity: 0.38 + enterProgress * 0.62,
        rotate: `${(1 - enterProgress) * 0.35}deg`,
        translate: `0 ${(1 - enterProgress) * base * 0.022}px`,
      }
      : {
        opacity: 0.35 + enterProgress * 0.65,
        scale: 0.985 + enterProgress * 0.015,
        translate: `0 ${(1 - enterProgress) * base * 0.032}px`,
      };
  const captionsVisible = Boolean(scene.narration && plan.captions?.enabled !== false);
  const captionReserve = captionsVisible
    ? Math.max(base * (vertical ? 0.52 : 0.24), vertical ? 580 : 260)
    : 0;
  const common: React.CSSProperties = {boxSizing: 'border-box', display: 'flex', height: '100%', padding: `${safeY}px ${safeRight}px ${safeY + captionReserve}px ${safeLeft}px`, position: 'relative', width: '100%'};
  const textColumn: React.CSSProperties = {display: 'flex', flexDirection: 'column', gap: base * 0.025, justifyContent: 'center', minWidth: 0};

  let content: React.ReactNode;
  if (scene.layout === 'split') {
    content = (
      <div style={{...common, alignItems: 'stretch', flexDirection: vertical ? 'column' : 'row', gap: base * 0.055}}>
        <div style={{...textColumn, flex: 1}}><Header scene={scene} plan={plan} base={base} /><Title text={scene.title} plan={plan} base={base} /><Body text={scene.body} plan={plan} base={base} /></div>
        <MediaPanel scene={scene} plan={plan} compact={vertical} />
      </div>
    );
  } else if (scene.layout === 'full-media' && scene.media) {
    content = (
      <div style={{...common, alignItems: 'flex-end', justifyContent: 'flex-start', overflow: 'hidden'}}>
        <Img src={staticFile(scene.media.src)} style={{height: '100%', inset: 0, objectFit: scene.media.fit ?? 'cover', position: 'absolute', width: '100%'}} />
        <div style={{position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${plan.theme.foreground}e8 0%, ${plan.theme.foreground}9e 48%, transparent 82%)`}} />
        <div style={{...textColumn, color: '#fff', maxWidth: vertical ? '100%' : '58%', position: 'relative'}}>
          <Header scene={scene} plan={{...plan, theme: {...plan.theme, accent: '#ffffff'}}} base={base} />
          <Title text={scene.title} plan={plan} base={base} large />
          {scene.body ? <div style={{fontFamily: design.font, fontSize: Math.max(44, base * 0.041), lineHeight: 1.45, opacity: 0.9}}>{scene.body}</div> : null}
        </div>
      </div>
    );
  } else if (scene.layout === 'stat') {
    content = (
      <div style={{...common, alignItems: vertical ? 'flex-start' : 'center', flexDirection: vertical ? 'column' : 'row', gap: base * 0.07, justifyContent: 'center'}}>
        <div style={{color: plan.theme.accent, flex: '0 1 auto', fontFamily: design.heading, fontSize: Math.max(170, base * 0.23), fontWeight: 900, letterSpacing: '-0.07em', lineHeight: 0.9}}>{scene.stat?.value ?? scene.title}</div>
        <div style={{...textColumn, flex: 1, maxWidth: vertical ? '100%' : width * 0.45}}><Header scene={scene} plan={plan} base={base} /><Title text={scene.stat?.label ?? scene.title} plan={plan} base={base} /><Body text={scene.body} plan={plan} base={base} /></div>
      </div>
    );
  } else if (scene.layout === 'list' || scene.layout === 'timeline') {
    const bullets = scene.bullets ?? (scene.body ? [scene.body] : []);
    content = (
      <div style={{...common, flexDirection: vertical ? 'column' : 'row', gap: base * 0.065}}>
        <div style={{...textColumn, flex: 0.85}}><Header scene={scene} plan={plan} base={base} /><Title text={scene.title} plan={plan} base={base} /></div>
        <div style={{display: 'flex', flex: 1.15, flexDirection: 'column', gap: base * 0.024, justifyContent: 'center'}}>
          {bullets.map((bullet, index) => {
            const itemOpacity = scene.durationInFrames <= 1
              ? 1
              : interpolate(frame, [fps * (0.12 + index * 0.12), fps * (0.42 + index * 0.12)], [0.2, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
            return <div key={`${scene.id}-${index}`} style={{alignItems: 'center', background: scene.layout === 'list' ? design.surface : 'transparent', border: scene.layout === 'list' ? `${Math.max(2, base * 0.002)}px solid ${design.border}` : undefined, display: 'flex', gap: base * 0.026, opacity: itemOpacity, padding: scene.layout === 'list' ? `${base * 0.025}px ${base * 0.03}px` : `${base * 0.015}px 0`, position: 'relative'}}>
              {scene.layout === 'timeline' ? <div style={{alignSelf: 'stretch', borderLeft: `${base * 0.006}px solid ${index === 0 ? plan.theme.accent : design.secondary}`, marginLeft: base * 0.018}} /> : null}
              <div style={{alignItems: 'center', background: index === 0 ? plan.theme.accent : design.secondary, color: index === 0 ? '#fff' : plan.theme.foreground, display: 'flex', flex: '0 0 auto', fontFamily: design.heading, fontSize: Math.max(30, base * 0.03), fontWeight: 900, height: base * 0.072, justifyContent: 'center', width: base * 0.072}}>{index + 1}</div>
              <div style={{fontFamily: design.font, fontSize: Math.max(40, base * 0.038), fontWeight: 650, lineHeight: 1.35}}>{bullet}</div>
            </div>;
          })}
        </div>
      </div>
    );
  } else if (scene.layout === 'quote') {
    const quoteText = scene.body ?? scene.title;
    const quoteCharacters = Array.from(quoteText).length;
    const quoteLengthScale = quoteCharacters > 72 ? 0.78 : quoteCharacters > 42 ? 0.88 : 1;
    const quoteFontSize = Math.max(vertical ? 64 : 72, base * (vertical ? 0.06 : 0.072) * quoteLengthScale);
    content = (
      <div style={{...common, alignItems: 'center', flexDirection: 'column', justifyContent: 'center', textAlign: 'center'}}>
        <div style={{color: plan.theme.accent, fontFamily: design.heading, fontSize: base * 0.18, height: base * 0.13, lineHeight: 1}}>“</div>
        <div style={{...balancedTextStyle, fontFamily: design.heading, fontSize: quoteFontSize, fontWeight: (plan.template === 'archive-paper' || plan.template === 'campus-archive') ? 650 : 760, letterSpacing: '-0.018em', lineHeight: 1.24, maxWidth: vertical ? '100%' : '82%', textAlign: 'center', width: '100%'}}>
          {keepLastChinesePair(quoteText)}
        </div>
        <div style={{height: base * 0.01, margin: `${base * 0.045}px 0 ${base * 0.025}px`, width: base * 0.12, background: plan.theme.accent}} />
        <Body text={scene.eyebrow ?? (scene.body ? scene.title : undefined)} plan={plan} base={base} centered />
      </div>
    );
  } else if (scene.layout === 'end-card') {
    content = (
      <div style={{...common, alignItems: 'center', flexDirection: 'column', justifyContent: 'center', textAlign: 'center'}}>
        {scene.eyebrow ? <div style={{background: plan.theme.accent, color: '#fff', fontFamily: design.heading, fontSize: Math.max(48, base * 0.055), fontWeight: 900, marginBottom: base * 0.05, padding: `${base * 0.018}px ${base * 0.035}px`}}>{scene.eyebrow}</div> : null}
        <Title text={scene.title} plan={plan} base={base} centered large />
        <div style={{marginTop: base * 0.03}}><Body text={scene.body} plan={plan} base={base} centered /></div>
      </div>
    );
  } else {
    content = (
      <div style={{...common, alignItems: 'center', flexDirection: 'column', gap: base * 0.027, justifyContent: 'center', textAlign: 'center'}}>
        <Header scene={scene} plan={plan} base={base} />
        <Title text={scene.title} plan={plan} base={base} centered large />
        <Body text={scene.body} plan={plan} base={base} centered />
        {scene.media ? <div style={{height: vertical ? height * 0.32 : height * 0.3, marginTop: base * 0.02, width: vertical ? '100%' : '58%'}}><MediaPanel scene={scene} plan={plan} compact /></div> : null}
      </div>
    );
  }

  return (
    <AbsoluteFill style={{backgroundColor: plan.theme.background, color: plan.theme.foreground}}>
      <TemplateBackdrop plan={plan} />
      <div style={{...motionStyle, fontFamily: design.font, height: '100%', transformOrigin: '50% 50%', width: '100%'}}>{content}</div>
    </AbsoluteFill>
  );
};
