import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RunnerError,
  commitRenderedArtifacts,
  copyPlainFileExclusive,
  loadPlan,
  listVoiceoverJobs,
  plainExistingPathWithin,
  sourceVoiceoverJobs,
  stageBgm,
  stageVoiceover,
  summarizePlan,
} from '../packages/artifact-services/lib/video-runner.js';

const workspaceCapabilities = {
  version: 1,
  capabilities: ['video-plan-v2', 'scene-voiceover-v2', 'remotion-captions-v1'],
};
const fakeMp3 = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);
const fakeMp3Checksum = createHash('sha256').update(fakeMp3).digest('hex');

const writeWorkspaceCapabilities = (workspace) => {
  writeFileSync(path.join(workspace, '.ecnu-video-workspace.json'), JSON.stringify(workspaceCapabilities));
};

const fixture = (t, name) => {
  const root = mkdtempSync(path.join(os.tmpdir(), `ecnu-video-${name}-`));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return root;
};

const fakeAudioRuntime = (durations, onCompute) => ({
  managedRequire(name) {
    assert.equal(name, 'mediabunny');
    return {
      ALL_FORMATS: [],
      FilePathSource: class FilePathSource {
        constructor(file) { this.file = file; }
      },
      Input: class Input {
        constructor({source}) { this.file = source.file; }
        async canRead() { return true; }
        async getAudioTracks() {
          return [{
            async getCodec() { return 'mp3'; },
            async getNumberOfChannels() { return 1; },
            async getSampleRate() { return 24000; },
          }];
        }
        async computeDuration() {
          await onCompute?.(this.file);
          return durations[path.basename(this.file)] ?? durations.default;
        }
        dispose() {}
      },
      EncodedPacketSink: class EncodedPacketSink {
        async *packets() {
          yield {timestamp: 0, duration: 0.02, byteLength: 4, data: fakeMp3};
        }
      },
    };
  },
});

const writeBoundVoiceoverPlan = (workspace, raw) => {
  mkdirSync(path.join(workspace, 'public', 'audio', 'narration'), {recursive: true});
  mkdirSync(path.join(workspace, '.voiceover-bindings'), {recursive: true});
  writeWorkspaceCapabilities(workspace);
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(raw));
  const {jobs} = sourceVoiceoverJobs(raw);
  const job = jobs[0];
  const src = `audio/narration/${fakeMp3Checksum.slice(0, 32)}.mp3`;
  const audio = path.join(workspace, 'public', ...src.split('/'));
  writeFileSync(audio, fakeMp3);
  writeFileSync(
    path.join(workspace, ...job.binding.split('/')),
    JSON.stringify({
      version: 1,
      sceneId: job.sceneId,
      jobHash: job.jobHash,
      src,
      sha256: fakeMp3Checksum,
      durationSeconds: 999,
    }),
  );
  return job;
};

const basicV2Plan = (overrides = {}) => ({
  version: 2,
  id: 'stage-test',
  title: 'Stage test',
  template: 'liwa-editorial',
  aspectRatio: '16:9',
  fps: 30,
  scenes: [{id: 'opening', layout: 'hero', title: '开场', narration: '绑定这一段字幕和配音。'}],
  audio: {bgm: null},
  ...overrides,
});

const captureStdoutJSON = async (callback) => {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    await callback();
  } finally {
    process.stdout.write = originalWrite;
  }
  return JSON.parse(output.trim());
};

test('accepts provider voice identifiers; availability is checked by speech service', () => {
  const voices = [
    'xiayu', 'liwa', 'male_warm', 'male_steady', 'male_news', 'male_philosophy', 'yunze',
    'female_sweet', 'female_literary', 'female_news', 'sichuan', 'tianjin', 'shaanxi',
    'japanese', 'lindaiyu', 'labixiaoxin',
  ];
  for (const voice of voices) {
    const {config, jobs} = sourceVoiceoverJobs(basicV2Plan({voiceover: {voice}}));
    assert.equal(config.voice, voice);
    assert.equal(jobs[0].voice, voice);
  }
  assert.equal(sourceVoiceoverJobs(basicV2Plan({voiceover:{voice:'third-party-voice'}})).config.voice,'third-party-voice');
  assert.throws(()=>sourceVoiceoverJobs(basicV2Plan({voiceover:{voice:123}})),error=>error.code==='invalid_plan');
});

test('stage-bgm copies only a licensed catalog entry with matching integrity metadata', async (t) => {
  const projectRoot = fixture(t, 'stage-bgm');
  const workspace = path.join(projectRoot, '.ecnu-agent', 'video-projects', 'demo');
  mkdirSync(path.join(workspace, 'public'), {recursive: true});
  const bgmRoot = path.join(projectRoot, 'managed-bgm');
  mkdirSync(bgmRoot);
  const trackBytes = Buffer.from('licensed test audio');
  const checksum = createHash('sha256').update(trackBytes).digest('hex');
  writeFileSync(path.join(bgmRoot, 'licensed.mp3'), trackBytes);
  const catalogPath = path.join(bgmRoot, 'catalog.json');
  writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    tracks: [{
      id: 'licensed',
      title: 'Licensed track',
      filename: 'licensed.mp3',
      author: 'Test author',
      license: 'Test redistribution license',
      source: 'https://example.test/license',
      sha256: checksum,
      durationSeconds: 12.5,
    }],
  }));

  const result = await captureStdoutJSON(() => stageBgm({
    'project-root': projectRoot,
    workspace,
    'track-id': 'licensed',
  }, {bgmRoot}));
  assert.equal(result.ok, true);
  assert.equal(result.track.license, 'Test redistribution license');
  assert.equal(result.destination, 'audio/bgm-licensed.mp3');
  assert.equal(existsSync(path.join(workspace, 'public', 'audio', 'bgm-licensed.mp3')), true);

  const secondWorkspace = path.join(projectRoot, '.ecnu-agent', 'video-projects', 'tampered');
  mkdirSync(path.join(secondWorkspace, 'public'), {recursive: true});
  writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    tracks: [{
      id: 'licensed',
      title: 'Licensed track',
      filename: 'licensed.mp3',
      author: 'Test author',
      license: 'Test redistribution license',
      source: 'https://example.test/license',
      sha256: '0'.repeat(64),
      durationSeconds: 12.5,
    }],
  }));
  assert.throws(
    () => stageBgm({'project-root': projectRoot, workspace: secondWorkspace, 'track-id': 'licensed'}, {bgmRoot}),
    (error) => error instanceof RunnerError && error.code === 'invalid_bgm_catalog' && error.message.includes('integrity'),
  );
});

test('linked workspace components and destination parents are rejected', (t) => {
  const root = fixture(t, 'paths');
  const trusted = path.join(root, 'trusted');
  const outside = path.join(root, 'outside');
  mkdirSync(trusted);
  mkdirSync(outside);
  const linked = path.join(trusted, 'linked');
  symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');

  assert.throws(
    () => plainExistingPathWithin(trusted, linked, 'directory', 'linked directory'),
    (error) => error instanceof RunnerError && error.code === 'unsafe_path',
  );

  const source = path.join(root, 'source.wav');
  writeFileSync(source, 'audio');
  assert.throws(
    () => copyPlainFileExclusive(source, path.join(linked, 'voice.wav'), trusted, 'voice destination'),
    (error) => error instanceof RunnerError && error.code === 'unsafe_path',
  );
  assert.equal(existsSync(path.join(outside, 'voice.wav')), false);
});

test('narration that is longer than its timeline window is rejected', async (t) => {
  const workspace = fixture(t, 'narration');
  mkdirSync(path.join(workspace, 'public', 'audio'), {recursive: true});
  const wav = Buffer.alloc(48);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(40, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(4, 40);
  writeFileSync(path.join(workspace, 'public', 'audio', 'voice.wav'), wav);
  writeFileSync(
    path.join(workspace, 'video-plan.json'),
    JSON.stringify({
      version: 1,
      id: 'duration-test',
      title: 'Duration test',
      aspectRatio: '16:9',
      fps: 30,
      theme: {background: '#ffffff', foreground: '#111111', accent: '#9f1d2d', muted: '#777777'},
      scenes: [{id: 'scene-one', durationSeconds: 1, title: 'Scene'}],
      audio: {narration: [{src: 'audio/voice.wav', startSeconds: 0, endSeconds: 1}]},
    }),
  );

  let disposed = false;
  const runtime = {
    managedRequire(name) {
      assert.equal(name, 'mediabunny');
      return {
        ALL_FORMATS: [],
        FilePathSource: class FilePathSource {},
        Input: class Input {
          async canRead() { return true; }
          async getAudioTracks() {
            return [{
              async getCodec() { return 'pcm-s16'; },
              async getNumberOfChannels() { return 1; },
              async getSampleRate() { return 24000; },
            }];
          }
          async computeDuration() { return 2; }
          dispose() { disposed = true; }
        },
        EncodedPacketSink: class EncodedPacketSink {
          async *packets() { yield {timestamp: 0, duration: 2, byteLength: 4, data: wav.subarray(44)}; }
        },
      };
    },
  };

  await assert.rejects(
    loadPlan(workspace, runtime),
    (error) => error instanceof RunnerError
      && error.code === 'narration_would_truncate'
      && error.details.requiredEndSeconds === 2,
  );
  assert.equal(disposed, true);
});

test('version 2 derives scene frames and captions from the real per-scene audio duration', async (t) => {
  const workspace = fixture(t, 'voiceover-v2');
  const raw = {
    version: 2,
    id: 'voiceover-test',
    title: 'Voiceover test',
    template: 'digital-pulse',
    aspectRatio: '16:9',
    fps: 30,
    voiceover: {voice: 'xiayu', format: 'mp3', speed: 1, leadInSeconds: 0.2, tailSeconds: 0.4, showCaptions: true},
    scenes: [
      {id: 'opening', layout: 'hero', title: '开场', narration: '先写字幕，再生成这一段配音。'},
      {id: 'ending', layout: 'end-card', title: '结束', durationSeconds: 2},
    ],
    audio: {bgm: null},
  };
  writeBoundVoiceoverPlan(workspace, raw);

  const plan = await loadPlan(workspace, fakeAudioRuntime({default: 2.01}));
  assert.equal(plan.version, 2);
  assert.equal(plan.template, 'digital-pulse');
  assert.equal(plan.captions.enabled, true);
  assert.equal(plan.scenes[0].narration.text, raw.scenes[0].narration);
  assert.equal(plan.scenes[0].narration.fromFrame, 6);
  assert.equal(plan.scenes[0].narration.durationInFrames, 61);
  assert.equal(plan.scenes[0].durationInFrames, 79);
  assert.equal(plan.scenes[1].durationInFrames, 60);
  const summary = summarizePlan(plan);
  assert.equal(summary.totalFrames, 139);
  assert.equal(summary.voiceoverSegments, 1);
  assert.deepEqual(summary.timeline.map((scene) => scene.fromFrame), [0, 79]);
  assert.equal(summary.timeline[0].narrationFromFrame, 6);
});

test('changing voiceover text invalidates the old bound audio', async (t) => {
  const workspace = fixture(t, 'voiceover-stale');
  const raw = {
    version: 2,
    id: 'stale-test',
    title: 'Stale test',
    template: 'liwa-editorial',
    aspectRatio: '16:9',
    fps: 30,
    scenes: [{id: 'opening', layout: 'hero', title: '开场', narration: '第一版字幕。'}],
    audio: {bgm: null},
  };
  const oldJob = writeBoundVoiceoverPlan(workspace, raw);
  raw.scenes[0].narration = '已经修改过的第二版字幕。';
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(raw));
  const {jobs: [newJob]} = sourceVoiceoverJobs(raw);
  assert.notEqual(newJob.jobHash, oldJob.jobHash);
  await assert.rejects(
    loadPlan(workspace, fakeAudioRuntime({default: 1})),
    (error) => error instanceof RunnerError && error.code === 'voiceover_not_ready' && error.details.jobHash === newJob.jobHash,
  );
});

test('version 2 rejects manual duration on a narrated scene', async (t) => {
  const workspace = fixture(t, 'voiceover-manual-duration');
  mkdirSync(path.join(workspace, 'public'), {recursive: true});
  writeWorkspaceCapabilities(workspace);
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify({
    version: 2,
    id: 'manual-duration',
    title: 'Manual duration',
    template: 'campus-archive',
    aspectRatio: '9:16',
    fps: 30,
    scenes: [{id: 'opening', layout: 'hero', title: '开场', durationSeconds: 5, narration: '这段时长必须由真实音频决定。'}],
    audio: {bgm: null},
  }));
  await assert.rejects(
    loadPlan(workspace, fakeAudioRuntime({default: 1})),
    (error) => error instanceof RunnerError && error.code === 'invalid_plan' && error.message.includes('durationSeconds must be omitted'),
  );
});

test('target duration is checked after voiceover timing is resolved', async (t) => {
  const workspace = fixture(t, 'voiceover-target');
  const raw = {
    version: 2,
    id: 'target-test',
    title: 'Target test',
    targetDurationSeconds: 10,
    durationToleranceSeconds: 0.5,
    template: 'liwa-editorial',
    aspectRatio: '16:9',
    fps: 30,
    scenes: [{id: 'opening', layout: 'hero', title: '开场', narration: '很短的一段。'}],
    audio: {bgm: null},
  };
  writeBoundVoiceoverPlan(workspace, raw);
  await assert.rejects(
    loadPlan(workspace, fakeAudioRuntime({default: 2})),
    (error) => error instanceof RunnerError
      && error.code === 'target_duration_mismatch'
      && error.details.targetDurationSeconds === 10
      && error.details.actualDurationSeconds < 3,
  );
});

test('stage-voiceover binds one TTS result to its exact scene job', async (t) => {
  const projectRoot = fixture(t, 'stage-voiceover');
  const workspace = path.join(projectRoot, '.ecnu-agent', 'video-projects', 'demo');
  mkdirSync(path.join(workspace, 'public'), {recursive: true});
  writeWorkspaceCapabilities(workspace);
  const raw = {
    version: 2,
    id: 'stage-test',
    title: 'Stage test',
    template: 'liwa-editorial',
    aspectRatio: '16:9',
    fps: 30,
    scenes: [{id: 'opening', layout: 'hero', title: '开场', narration: '绑定这一段字幕和配音。'}],
    audio: {bgm: null},
  };
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(raw));
  const generated = path.join(projectRoot, '.ecnu-agent', 'generated', 'audio');
  mkdirSync(generated, {recursive: true});
  const input = path.join(generated, 'tts.mp3');
  writeFileSync(input, fakeMp3);
  const runtime = fakeAudioRuntime({default: 1.25});
  const {jobs: [job]} = sourceVoiceoverJobs(raw);
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    await stageVoiceover({'project-root': projectRoot, workspace, input, 'scene-id': 'opening', 'job-hash': job.jobHash}, runtime);
  } finally {
    process.stdout.write = originalWrite;
  }
  const plan = await loadPlan(workspace, runtime);
  assert.equal(plan.scenes[0].narration.audioDurationSeconds, 1.25);
  assert.match(plan.scenes[0].narration.src, /^audio\/narration\/[0-9a-f]{32}\.mp3$/);
  assert.equal(existsSync(path.join(workspace, 'public', ...plan.scenes[0].narration.src.split('/'))), true);
});

test('version 2 workspaces require the current renderer capability marker', async (t) => {
  const workspace = fixture(t, 'old-workspace');
  mkdirSync(path.join(workspace, 'public'), {recursive: true});
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(basicV2Plan()));
  await assert.rejects(
    loadPlan(workspace, fakeAudioRuntime({default: 1})),
    (error) => error instanceof RunnerError && error.code === 'workspace_upgrade_required',
  );
});

test('voiceover-jobs performs complete v2 draft validation before returning TTS work', async (t) => {
  const projectRoot = fixture(t, 'draft-validation');
  const workspace = path.join(projectRoot, '.ecnu-agent', 'video-projects', 'demo');
  mkdirSync(path.join(workspace, 'public'), {recursive: true});
  writeWorkspaceCapabilities(workspace);
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(basicV2Plan({
    scenes: [{id: 'opening', layout: 'split', title: '缺少图片', narration: '不应开始语音生成。'}],
  })));
  await assert.rejects(
    listVoiceoverJobs({'project-root': projectRoot, workspace}, fakeAudioRuntime({default: 1})),
    (error) => error instanceof RunnerError && error.code === 'invalid_plan' && error.message.includes('requires local image media'),
  );
});

test('damaged binding remains discoverable and explicit stage repairs it', async (t) => {
  const projectRoot = fixture(t, 'binding-repair');
  const workspace = path.join(projectRoot, '.ecnu-agent', 'video-projects', 'demo');
  mkdirSync(workspace, {recursive: true});
  const raw = basicV2Plan();
  const job = writeBoundVoiceoverPlan(workspace, raw);
  rmSync(path.join(workspace, 'public', 'audio', 'narration', `${fakeMp3Checksum.slice(0, 32)}.mp3`), {force: true});
  const runtime = fakeAudioRuntime({default: 1.4});
  const jobsOutput = await captureStdoutJSON(() => listVoiceoverJobs({'project-root': projectRoot, workspace}, runtime));
  assert.equal(jobsOutput.jobs[0].ready, false);
  assert.equal(jobsOutput.jobs[0].repairRequired, true);
  assert.equal(jobsOutput.jobs[0].jobHash, job.jobHash);

  const generated = path.join(projectRoot, '.ecnu-agent', 'generated', 'audio');
  mkdirSync(generated, {recursive: true});
  const input = path.join(generated, 'tts.mp3');
  writeFileSync(input, fakeMp3);
  const staged = await captureStdoutJSON(() => stageVoiceover({
    'project-root': projectRoot,
    workspace,
    input,
    'scene-id': 'opening',
    'job-hash': job.jobHash,
  }, runtime));
  assert.equal(staged.ok, true);
  assert.match(staged.destination, /^audio\/narration\/[0-9a-f]{32}\.mp3$/);
  assert.equal((await loadPlan(workspace, runtime)).scenes[0].narration.audioDurationSeconds, 1.4);
});

test('stage-voiceover requires the current job hash and rejects a plan race', async (t) => {
  const projectRoot = fixture(t, 'job-race');
  const workspace = path.join(projectRoot, '.ecnu-agent', 'video-projects', 'demo');
  mkdirSync(path.join(workspace, 'public'), {recursive: true});
  writeWorkspaceCapabilities(workspace);
  const raw = basicV2Plan();
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(raw));
  const {jobs: [job]} = sourceVoiceoverJobs(raw);
  const generated = path.join(projectRoot, '.ecnu-agent', 'generated', 'audio');
  mkdirSync(generated, {recursive: true});
  const input = path.join(generated, 'tts.mp3');
  writeFileSync(input, fakeMp3);

  await assert.rejects(
    stageVoiceover({'project-root': projectRoot, workspace, input, 'scene-id': 'opening'}, fakeAudioRuntime({default: 1})),
    (error) => error instanceof RunnerError && error.code === 'usage' && error.message.includes('--job-hash'),
  );
  await assert.rejects(
    stageVoiceover({'project-root': projectRoot, workspace, input, 'scene-id': 'opening', 'job-hash': '0'.repeat(64)}, fakeAudioRuntime({default: 1})),
    (error) => error instanceof RunnerError && error.code === 'voiceover_job_changed',
  );

  let changed = false;
  const runtime = fakeAudioRuntime({default: 1}, () => {
    if (changed) return;
    changed = true;
    raw.scenes[0].narration = '计划已经在探测期间发生变化。';
    writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(raw));
  });
  await assert.rejects(
    stageVoiceover({'project-root': projectRoot, workspace, input, 'scene-id': 'opening', 'job-hash': job.jobHash}, runtime),
    (error) => error instanceof RunnerError && error.code === 'voiceover_job_changed',
  );
  assert.equal(existsSync(path.join(workspace, ...job.binding.split('/'))), false);
});

test('stage commit survives stdout failure and concurrent publication is rejected', async (t) => {
  const projectRoot = fixture(t, 'commit-boundary');
  const workspace = path.join(projectRoot, '.ecnu-agent', 'video-projects', 'demo');
  mkdirSync(path.join(workspace, 'public'), {recursive: true});
  writeWorkspaceCapabilities(workspace);
  const raw = basicV2Plan();
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(raw));
  const {jobs: [job]} = sourceVoiceoverJobs(raw);
  const generated = path.join(projectRoot, '.ecnu-agent', 'generated', 'audio');
  mkdirSync(generated, {recursive: true});
  const input = path.join(generated, 'tts.mp3');
  writeFileSync(input, fakeMp3);
  const runtime = fakeAudioRuntime({default: 1.1});
  const options = {'project-root': projectRoot, workspace, input, 'scene-id': 'opening', 'job-hash': job.jobHash};
  const originalWrite = process.stdout.write;
  process.stdout.write = () => { throw new Error('stdout closed'); };
  try {
    await assert.rejects(stageVoiceover(options, runtime), /stdout closed/);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(existsSync(path.join(workspace, ...job.binding.split('/'))), true);
  assert.equal((await loadPlan(workspace, runtime)).scenes[0].narration.audioDurationSeconds, 1.1);

  const alreadyReady = await captureStdoutJSON(() => stageVoiceover(options, runtime));
  assert.equal(alreadyReady.alreadyReady, true);

  raw.scenes[0].narration = '并发提交必须只有一个赢家。';
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(raw));
  const {jobs: [nextJob]} = sourceVoiceoverJobs(raw);
  const concurrentOptions = {...options, 'job-hash': nextJob.jobHash};
  process.stdout.write = () => true;
  let settled;
  try {
    settled = await Promise.allSettled([
      stageVoiceover(concurrentOptions, runtime),
      stageVoiceover(concurrentOptions, runtime),
    ]);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = settled.find((item) => item.status === 'rejected');
  assert.equal(rejected.reason instanceof RunnerError, true);
  assert.equal(rejected.reason.code, 'voiceover_stage_race');
});

test('stage-voiceover recovers an orphaned content-addressed audio commit', async (t) => {
  const projectRoot = fixture(t, 'orphan-audio');
  const workspace = path.join(projectRoot, '.ecnu-agent', 'video-projects', 'demo');
  const narrationRoot = path.join(workspace, 'public', 'audio', 'narration');
  mkdirSync(narrationRoot, {recursive: true});
  writeWorkspaceCapabilities(workspace);
  const raw = basicV2Plan();
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(raw));
  const {jobs: [job]} = sourceVoiceoverJobs(raw);
  const checksum = createHash('sha256').update(fakeMp3).digest('hex');
  const orphan = path.join(narrationRoot, `${checksum.slice(0, 32)}.mp3`);
  writeFileSync(orphan, fakeMp3);
  const generated = path.join(projectRoot, '.ecnu-agent', 'generated', 'audio');
  mkdirSync(generated, {recursive: true});
  const input = path.join(generated, 'tts.mp3');
  writeFileSync(input, fakeMp3);

  const staged = await captureStdoutJSON(() => stageVoiceover({
    'project-root': projectRoot,
    workspace,
    input,
    'scene-id': 'opening',
    'job-hash': job.jobHash,
  }, fakeAudioRuntime({default: 1.3})));
  assert.equal(staged.reused, true);
  assert.equal(staged.sha256, checksum);
  assert.equal(existsSync(path.join(workspace, ...job.binding.split('/'))), true);
});

test('stage-voiceover enforces 64 MiB and requested container bytes', async (t) => {
  const projectRoot = fixture(t, 'stage-input');
  const workspace = path.join(projectRoot, '.ecnu-agent', 'video-projects', 'demo');
  mkdirSync(path.join(workspace, 'public'), {recursive: true});
  writeWorkspaceCapabilities(workspace);
  const raw = basicV2Plan();
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(raw));
  const {jobs: [job]} = sourceVoiceoverJobs(raw);
  const generated = path.join(projectRoot, '.ecnu-agent', 'generated', 'audio');
  mkdirSync(generated, {recursive: true});
  const oversized = path.join(generated, 'oversized.mp3');
  writeFileSync(oversized, fakeMp3);
  truncateSync(oversized, 64 * 1024 * 1024 + 1);
  const options = {'project-root': projectRoot, workspace, 'scene-id': 'opening', 'job-hash': job.jobHash};
  await assert.rejects(
    stageVoiceover({...options, input: oversized}, fakeAudioRuntime({default: 1})),
    (error) => error instanceof RunnerError && error.code === 'asset_too_large',
  );

  const disguised = path.join(generated, 'disguised.mp3');
  const wavPlan = basicV2Plan({voiceover: {format: 'wav'}});
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify(wavPlan));
  const {jobs: [wavJob]} = sourceVoiceoverJobs(wavPlan);
  const disguisedWav = path.join(generated, 'disguised.wav');
  writeFileSync(disguisedWav, fakeMp3);
  await assert.rejects(
    stageVoiceover({'project-root': projectRoot, workspace, input: disguisedWav, 'scene-id': 'opening', 'job-hash': wavJob.jobHash}, fakeAudioRuntime({default: 1})),
    (error) => error instanceof RunnerError && error.code === 'voiceover_format_mismatch' && error.message.includes('bytes'),
  );
  assert.equal(existsSync(disguised), false);
});

test('version 1 coverFrame uses the same rounded scene timeline as Remotion', async (t) => {
  const workspace = fixture(t, 'v1-cover');
  mkdirSync(path.join(workspace, 'public'), {recursive: true});
  writeFileSync(path.join(workspace, 'video-plan.json'), JSON.stringify({
    version: 1,
    id: 'cover-rounding',
    title: 'Cover rounding',
    aspectRatio: '16:9',
    fps: 24,
    coverFrame: 48,
    theme: {background: '#ffffff', foreground: '#111111', accent: '#9f1d2d', muted: '#777777'},
    scenes: [
      {id: 'one', durationSeconds: 1.02, title: 'One'},
      {id: 'two', durationSeconds: 1.02, title: 'Two'},
    ],
  }));
  await assert.rejects(
    loadPlan(workspace, {}),
    (error) => error instanceof RunnerError && error.code === 'invalid_plan' && error.message.includes('coverFrame'),
  );
});

test('failed artifact commit cleans partial output so the same id can retry', (t) => {
  const root = fixture(t, 'commit');
  const staging = path.join(root, 'staging');
  const output = path.join(root, 'output');
  mkdirSync(path.join(staging, 'clip-checks'), {recursive: true});
  mkdirSync(output);
  writeFileSync(path.join(staging, 'clip-checks', 'first.png'), 'first');
  writeFileSync(path.join(staging, 'clip.mp4'), 'video');

  const staged = {
    checks: path.join(staging, 'clip-checks'),
    cover: path.join(staging, 'clip-cover.png'),
    video: path.join(staging, 'clip.mp4'),
  };
  const final = {
    checks: path.join(output, 'clip-checks'),
    cover: path.join(output, 'clip-cover.png'),
    video: path.join(output, 'clip.mp4'),
  };

  assert.throws(
    () => commitRenderedArtifacts(staged, final),
    (error) => error instanceof RunnerError && error.code === 'commit_failed',
  );
  assert.equal(existsSync(final.checks), false);
  assert.equal(existsSync(final.cover), false);
  assert.equal(existsSync(final.video), false);

  mkdirSync(staged.checks);
  writeFileSync(path.join(staged.checks, 'first.png'), 'first');
  writeFileSync(staged.cover, 'cover');
  commitRenderedArtifacts(staged, final);
  assert.equal(existsSync(final.checks), true);
  assert.equal(existsSync(final.cover), true);
  assert.equal(existsSync(final.video), true);
});
