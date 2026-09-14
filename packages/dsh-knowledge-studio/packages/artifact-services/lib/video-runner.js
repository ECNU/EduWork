import {createMediaRuntime} from './runtime.js'

import {createHash, randomBytes} from 'node:crypto';
import {
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {voiceTiming} from './timeline.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {prepareComposition,renderComposition,renderFrame} from './remotion.js';
const commandContext=new AsyncLocalStorage();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const templateRoot = path.join(skillRoot, 'templates', 'editable');
const pinnedEnvironmentRoot = path.join(skillRoot, 'templates', 'node-environment');
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const assetPattern = /\.(?:png|jpe?g|webp|gif|mp3|wav|aac|m4a|ogg|opus|flac)$/i;
const imagePattern = /\.(?:png|jpe?g|webp|gif)$/i;
const audioPattern = /\.(?:mp3|wav|aac|m4a|ogg|opus|flac)$/i;
const videoTemplates = Object.freeze({
  'editorial': {background: '#fffaf6', foreground: '#201719', accent: '#315c86', muted: '#7b6f72'},
  'archive-paper': {background: '#f4ead7', foreground: '#2b211a', accent: '#9f2f35', muted: '#75685d'},
  'liwa-editorial': {background: '#fffaf6', foreground: '#201719', accent: '#b21f35', muted: '#7b6f72'},
  'digital-pulse': {background: '#eef7f6', foreground: '#0b2d35', accent: '#008c83', muted: '#527078'},
  'campus-archive': {background: '#f4ead7', foreground: '#2b211a', accent: '#9f2f35', muted: '#75685d'},
});
const sceneLayouts = new Set(['hero', 'split', 'full-media', 'list', 'stat', 'quote', 'timeline', 'end-card']);
const videoVoiceFormats = new Set(['mp3', 'opus', 'aac', 'flac', 'wav']);
const workspaceCapabilityFile = '.ecnu-video-workspace.json';
const v2WorkspaceCapabilities = Object.freeze(['video-plan-v2', 'scene-voiceover-v2', 'remotion-captions-v1']);
const maxVoiceoverBytes = 64 * 1024 * 1024;

class RunnerError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new RunnerError(code, message, details);
};

const emit = (value) => commandContext.getStore()?.result ? commandContext.getStore().result(value) : process.stdout.write(`${JSON.stringify(value)}\n`);
const progress = (stage, percent, message) =>
  process.stderr.write(`${JSON.stringify({type: 'progress', stage, percent, message})}\n`);

const parseArgs = (argv) => {
  if (argv.length === 0) fail('usage', 'missing command');
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      fail('usage', `invalid argument near ${key ?? '<end>'}`);
    }
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) fail('usage', `duplicate option --${name}`);
    options[name] = value;
  }
  return {command, options};
};

const required = (options, name) => {
  const value = options[name];
  if (!value) fail('usage', `missing --${name}`);
  return value;
};

const isInside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const pathLabel = (value) => path.basename(value) || value;

const plainDirectory = (raw, label) => {
  if (!path.isAbsolute(raw)) fail('invalid_path', `${label} must be absolute`);
  const absolute = path.resolve(raw);
  let info;
  try {
    info = lstatSync(absolute);
  } catch (error) {
    fail('invalid_path', `${label} is unavailable: ${error.message}`);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    fail('unsafe_path', `${label} must be a plain directory, not a link or reparse point`);
  }
  return realpathSync(absolute);
};

// Walk each component instead of trusting only the final realpath. This
// rejects a public/audio/src directory that was replaced by a symlink or a
// Windows junction after the workspace was initialized.
const plainExistingPathWithin = (rootRaw, candidateRaw, kind, label) => {
  const root = plainDirectory(rootRaw, `${label} root`);
  const candidate = path.resolve(candidateRaw);
  if (!isInside(root, candidate) || candidate === root) {
    fail('unsafe_path', `${label} must stay below ${pathLabel(root)}`);
  }
  const relative = path.relative(root, candidate);
  let current = root;
  const parts = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let info;
    try {
      info = lstatSync(current);
    } catch (error) {
      fail('invalid_path', `${label} is unavailable: ${error.message}`);
    }
    if (info.isSymbolicLink()) {
      fail('unsafe_path', `${label} contains a linked or reparse path component`);
    }
    const final = index === parts.length - 1;
    if ((!final || kind === 'directory') && !info.isDirectory()) {
      fail('unsafe_path', `${label} contains a non-directory path component`);
    }
    if (final && kind === 'file' && !info.isFile()) {
      fail('unsafe_path', `${label} must be a regular file`);
    }
    const real = realpathSync(current);
    if (!isInside(root, real)) {
      fail('unsafe_path', `${label} resolves outside its trusted root`);
    }
  }
  return realpathSync(candidate);
};

const ensurePlainDirectoryWithin = (rootRaw, targetRaw, label) => {
  const root = plainDirectory(rootRaw, `${label} root`);
  const target = path.resolve(targetRaw);
  if (!isInside(root, target)) {
    fail('unsafe_path', `${label} must stay below ${pathLabel(root)}`);
  }
  if (target === root) return root;
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (!existsSync(current)) mkdirSync(current);
    const info = lstatSync(current);
    if (info.isSymbolicLink() || !info.isDirectory() || !isInside(root, realpathSync(current))) {
      fail('unsafe_path', `${label} contains a linked, reparse or escaping directory`);
    }
  }
  return realpathSync(target);
};

const copyPlainFileExclusive = (source, target, trustedRoot, label, maxBytes = Number.POSITIVE_INFINITY) => {
  const parent = ensurePlainDirectoryWithin(trustedRoot, path.dirname(target), `${label} parent`);
  if (!isInside(parent, path.resolve(target)) || existsSync(target)) {
    fail('asset_exists', `${label} already exists`);
  }
  let input;
  let output;
  let created = false;
  let completed = false;
  try {
    input = openSync(source, 'r');
    output = openSync(target, 'wx', 0o600);
    created = true;
    const resolvedTarget = plainExistingPathWithin(trustedRoot, target, 'file', label);
    if (!isInside(parent, resolvedTarget)) fail('unsafe_path', `${label} escaped its destination directory`);
    const buffer = Buffer.allocUnsafe(128 * 1024);
    let total = 0;
    for (;;) {
      const count = readSync(input, buffer, 0, buffer.length, null);
      if (count === 0) break;
      let offset = 0;
      while (offset < count) offset += writeSync(output, buffer, offset, count - offset);
      total += count;
      if (total > maxBytes) {
        fail('asset_too_large', `${label} exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB limit`);
      }
    }
    closeSync(output);
    output = undefined;
    closeSync(input);
    input = undefined;
    completed = true;
    return total;
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    fail('copy_failed', `cannot stage ${label}: ${error.message}`);
  } finally {
    if (output !== undefined) closeSync(output);
    if (input !== undefined) closeSync(input);
    if (created && !completed) rmSync(target, {force: true});
  }
};

const existingDirectory = (raw, label) => {
  return plainDirectory(raw, label);
};

const assertManagedRuntime = () => {
  const nodeRootRaw = process.env.ECNU_AGENT_NODE_ROOT;
  const nodeEnvRaw = process.env.ECNU_AGENT_NODE_ENV;
  const nodeModulesRaw = process.env.ECNU_AGENT_NODE_MODULES;
  const browserRaw = process.env.ECNU_AGENT_REMOTION_BROWSER;
  const bgmRootRaw = process.env.ECNU_AGENT_BGM_ROOT;
  if (!nodeRootRaw || !nodeEnvRaw || !nodeModulesRaw || !browserRaw || !bgmRootRaw) {
    fail('managed_node_unavailable', 'ChatECNU Work managed Node environment is unavailable; ECNU_AGENT_NODE_ROOT, ECNU_AGENT_NODE_ENV, ECNU_AGENT_NODE_MODULES, ECNU_AGENT_REMOTION_BROWSER and ECNU_AGENT_BGM_ROOT are required');
  }
  const nodeRoot = existingDirectory(nodeRootRaw, 'ECNU_AGENT_NODE_ROOT');
  const nodeEnv = existingDirectory(nodeEnvRaw, 'ECNU_AGENT_NODE_ENV');
  const nodeModules = existingDirectory(nodeModulesRaw, 'ECNU_AGENT_NODE_MODULES');
  const bgmRoot = existingDirectory(bgmRootRaw, 'ECNU_AGENT_BGM_ROOT');
  if (!path.isAbsolute(browserRaw)) fail('untrusted_browser', 'ECNU_AGENT_REMOTION_BROWSER must be absolute');
  const browserExecutable = realpathSync(browserRaw);
  if (!statSync(browserExecutable).isFile() || !isInside(nodeEnv, browserExecutable)) {
    fail('untrusted_browser', 'ECNU_AGENT_REMOTION_BROWSER must be a regular file inside the managed Node environment');
  }
  const executable = realpathSync(process.execPath);
  if (!isInside(nodeRoot, executable)) {
    fail('host_node_rejected', 'current Node executable is outside ChatECNU Work managed runtime', {executable});
  }
  if (!isInside(nodeEnv, nodeModules)) {
    fail('untrusted_modules', 'ECNU_AGENT_NODE_MODULES must be inside ECNU_AGENT_NODE_ENV');
  }
  for (const packageName of ['remotion', '@remotion/media', '@remotion/bundler', '@remotion/renderer', '@remotion/captions', 'mediabunny']) {
    const packageJson = path.join(nodeModules, ...packageName.split('/'), 'package.json');
    if (!existsSync(packageJson)) fail('dependency_missing', `managed dependency is missing: ${packageName}`);
  }
  const pinnedLock = path.join(pinnedEnvironmentRoot, 'package-lock.json');
  const managedLock = path.join(nodeEnv, 'package-lock.json');
  if (!existsSync(pinnedLock) || !existsSync(managedLock) || sha256(pinnedLock) !== sha256(managedLock)) {
    fail('environment_lock_mismatch', 'managed Node package-lock does not match the video Skill lock');
  }
  plainExistingPathWithin(bgmRoot, path.join(bgmRoot, 'catalog.json'), 'file', 'BGM catalog');
  return {nodeEnv, nodeModules, browserExecutable, bgmRoot, managedRequire: createRequire(path.join(nodeEnv, 'package.json'))};
};

const projectContext = (options) => {
  const projectRoot = existingDirectory(required(options, 'project-root'), 'project root');
  const videoProjectsRoot = path.join(projectRoot, '.ecnu-agent', 'video-projects');
  const generatedRoot = path.join(projectRoot, '.ecnu-agent', 'generated', 'videos');
  return {projectRoot, videoProjectsRoot, generatedRoot};
};

const workspaceContext = (options) => {
  const context = projectContext(options);
  const allowedRoot = plainExistingPathWithin(context.projectRoot, context.videoProjectsRoot, 'directory', 'video projects directory');
  const workspaceRaw = required(options, 'workspace');
  if (!path.isAbsolute(workspaceRaw)) fail('invalid_path', 'workspace must be absolute');
  const workspaceCandidate = path.resolve(workspaceRaw);
  if (workspaceCandidate === allowedRoot || !isInside(allowedRoot, workspaceCandidate)) {
    fail('workspace_outside_project', 'workspace must be a child of .ecnu-agent/video-projects');
  }
  const workspace = plainExistingPathWithin(allowedRoot, workspaceCandidate, 'directory', 'workspace');
  const publicRoot = plainExistingPathWithin(workspace, path.join(workspace, 'public'), 'directory', 'workspace public directory');
  return {...context, workspace, publicRoot};
};

const safeRelativeAsset = (raw, label) => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\\') || path.isAbsolute(raw)) {
    fail('invalid_asset_path', `${label} must be a forward-slash relative path`);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || /^[a-z]+:/i.test(normalized)) {
    fail('invalid_asset_path', `${label} escapes public directory`);
  }
  return normalized;
};

const nonEmptyString = (value, label, max) => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    fail('invalid_plan', `${label} must be a non-empty string up to ${max} characters`);
  }
  return value;
};

const optionalString = (value, label, max) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) fail('invalid_plan', `${label} must be a string up to ${max} characters`);
  return value;
};

const volume = (value, fallback, label) => {
  const normalized = value ?? fallback;
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    fail('invalid_plan', `${label} must be between 0 and 1`);
  }
  return normalized;
};

const numberInRange = (value, fallback, minimum, maximum, label) => {
  const normalized = value ?? fallback;
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || normalized < minimum || normalized > maximum) {
    fail('invalid_plan', `${label} must be between ${minimum} and ${maximum}`);
  }
  return normalized;
};

const readRawPlan = (workspace) => {
  const planPath = plainExistingPathWithin(workspace, path.join(workspace, 'video-plan.json'), 'file', 'video plan');
  let raw;
  try {
    raw = JSON.parse(readFileSync(planPath, 'utf8'));
  } catch (error) {
    fail('invalid_plan_json', `cannot parse ${planPath}: ${error.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_plan', 'video plan must be an object');
  return raw;
};

const assertV2WorkspaceCapabilities = (workspace) => {
  const candidate = path.join(workspace, workspaceCapabilityFile);
  let markerPath;
  try {
    markerPath = plainExistingPathWithin(workspace, candidate, 'file', 'video workspace capability marker');
  } catch (error) {
    if (error instanceof RunnerError && error.code === 'invalid_path') {
      fail(
        'workspace_upgrade_required',
        `this video workspace predates the version 2 renderer; create a new workspace with init and copy the plan/assets into it`,
        {missingCapabilities: v2WorkspaceCapabilities},
      );
    }
    throw error;
  }
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  } catch (error) {
    fail('workspace_upgrade_required', `video workspace capability marker is invalid: ${error.message}`, {missingCapabilities: v2WorkspaceCapabilities});
  }
  const capabilities = Array.isArray(marker?.capabilities) ? new Set(marker.capabilities) : new Set();
  const missingCapabilities = v2WorkspaceCapabilities.filter((capability) => !capabilities.has(capability));
  if (marker?.version !== 1 || missingCapabilities.length > 0) {
    fail(
      'workspace_upgrade_required',
      'this video workspace does not support the current version 2 renderer; create a new workspace with init and copy the plan/assets into it',
      {missingCapabilities},
    );
  }
  return marker;
};

const normalizeVoiceoverConfig = (raw) => {
  const source = raw.voiceover ?? {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('invalid_plan', 'voiceover must be an object');
  const voice = source.voice ?? '';
  const format = source.format ?? 'mp3';
  if(typeof voice!=='string'||voice.length>128)fail('invalid_plan','voiceover.voice must be a voice identifier');
  if (!videoVoiceFormats.has(format)) fail('invalid_plan', 'voiceover.format must be mp3, opus, aac, flac or wav');
  if (source.showCaptions !== undefined && typeof source.showCaptions !== 'boolean') fail('invalid_plan', 'voiceover.showCaptions must be boolean');
  return {
    voice,
    format,
    speed: numberInRange(source.speed, 1, 0.25, 4, 'voiceover.speed'),
    leadInSeconds: numberInRange(source.leadInSeconds, 0.18, 0, 2, 'voiceover.leadInSeconds'),
    tailSeconds: numberInRange(source.tailSeconds, 0.45, 0.2, 3, 'voiceover.tailSeconds'),
    showCaptions: source.showCaptions ?? true,
  };
};

const voiceoverJobHash = ({sceneId, text, voice, format, speed}) => createHash('sha256')
  .update(JSON.stringify({version: 1, sceneId, text, voice, format, speed}), 'utf8')
  .digest('hex');

const sourceVoiceoverJobs = (raw) => {
  if (raw.version !== 2) return {config: null, jobs: []};
  if (!Array.isArray(raw.scenes) || raw.scenes.length < 1 || raw.scenes.length > 30) {
    fail('invalid_plan', 'scenes must contain 1-30 items');
  }
  const config = normalizeVoiceoverConfig(raw);
  const ids = new Set();
  const jobs = [];
  for (let index = 0; index < raw.scenes.length; index += 1) {
    const scene = raw.scenes[index];
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) fail('invalid_plan', `scenes[${index}] must be an object`);
    const sceneId = nonEmptyString(scene.id, `scenes[${index}].id`, 63);
    if (!slugPattern.test(sceneId) || ids.has(sceneId)) fail('invalid_plan', `scenes[${index}].id must be a unique slug`);
    ids.add(sceneId);
    if (scene.narration === undefined || scene.narration === null) continue;
    const text = nonEmptyString(scene.narration, `scenes[${index}].narration`, 42).trim();
    const job = {sceneId, text, voice: config.voice, format: config.format, speed: config.speed};
    const jobHash = voiceoverJobHash(job);
    // The full hash remains inside the binding. A short filename keeps deeply
    // nested Windows project paths below legacy path-length limits.
    jobs.push({...job, jobHash, binding: `.voiceover-bindings/${jobHash.slice(0, 24)}.json`});
  }
  return {config, jobs};
};

// Validates every version 2 field that does not depend on generated media.
// voiceover-jobs and stage-voiceover call this before any TTS output is used,
// so an invalid layout, asset reference or duration cannot waste a TTS call.
const validatePlanV2Draft = (raw) => {
  if (raw.version !== 2) fail('invalid_plan', 'version must be 2');
  if (!slugPattern.test(raw.id ?? '')) fail('invalid_plan', 'id must be a lowercase slug with 1-63 characters');
  const title = nonEmptyString(raw.title, 'title', 120);
  if (!['16:9', '9:16', '1:1'].includes(raw.aspectRatio)) fail('invalid_plan', 'aspectRatio must be 16:9, 9:16 or 1:1');
  if (![24, 25, 30].includes(raw.fps)) fail('invalid_plan', 'fps must be 24, 25 or 30');
  const template = raw.template ?? 'editorial';
  if (!Object.hasOwn(videoTemplates, template)) fail('invalid_plan', 'template must be editorial, digital-pulse or archive-paper (legacy template names are also supported)');
  if (raw.theme !== undefined && (!raw.theme || typeof raw.theme !== 'object' || Array.isArray(raw.theme))) fail('invalid_plan', 'theme must be an object');
  const baseTheme = videoTemplates[template];
  const color = (key) => {
    const value = raw.theme?.[key] ?? baseTheme[key];
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('invalid_plan', `theme.${key} must be #RRGGBB`);
    return value.toLowerCase();
  };
  const theme = {background: color('background'), foreground: color('foreground'), accent: color('accent'), muted: color('muted')};
  const {config: voiceover, jobs} = sourceVoiceoverJobs(raw);
  const jobsByScene = new Map(jobs.map((job) => [job.sceneId, job]));
  const targetDurationSeconds = raw.targetDurationSeconds === undefined
    ? undefined
    : numberInRange(raw.targetDurationSeconds, undefined, 3, 600, 'targetDurationSeconds');
  const durationToleranceSeconds = targetDurationSeconds === undefined
    ? undefined
    : numberInRange(raw.durationToleranceSeconds, Math.max(1, targetDurationSeconds * 0.05), 0.1, 60, 'durationToleranceSeconds');
  if (targetDurationSeconds === undefined && raw.durationToleranceSeconds !== undefined) {
    fail('invalid_plan', 'durationToleranceSeconds requires targetDurationSeconds');
  }
  const audio = raw.audio ?? {};
  if (!audio || typeof audio !== 'object' || Array.isArray(audio)) fail('invalid_plan', 'audio must be an object');
  if (audio.narration !== undefined && (!Array.isArray(audio.narration) || audio.narration.length > 0)) {
    fail('invalid_plan', 'version 2 uses scenes[].narration and cannot use legacy audio.narration');
  }

  const assets = [];
  const scenes = raw.scenes.map((scene, index) => {
    const id = nonEmptyString(scene.id, `scenes[${index}].id`, 63);
    const eyebrow = optionalString(scene.eyebrow, `scenes[${index}].eyebrow`, 24);
    const sceneTitle = nonEmptyString(scene.title, `scenes[${index}].title`, 48);
    const body = optionalString(scene.body, `scenes[${index}].body`, 100);
    let layout = scene.layout;
    if (layout === undefined) {
      layout = scene.stat ? 'stat' : scene.bullets ? 'list' : scene.media ? 'split' : index === raw.scenes.length - 1 && index > 0 ? 'end-card' : 'hero';
    }
    if (!sceneLayouts.has(layout)) fail('invalid_plan', `scenes[${index}].layout is unsupported`);

    let bullets;
    if (scene.bullets !== undefined) {
      if (!Array.isArray(scene.bullets) || scene.bullets.length < 2 || scene.bullets.length > 4) fail('invalid_plan', `scenes[${index}].bullets must contain 2-4 items`);
      bullets = scene.bullets.map((item, bulletIndex) => nonEmptyString(item, `scenes[${index}].bullets[${bulletIndex}]`, 40));
    }
    if (['list', 'timeline'].includes(layout) && !bullets) fail('invalid_plan', `scenes[${index}].${layout} layout requires bullets`);

    let stat;
    if (scene.stat !== undefined) {
      if (!scene.stat || typeof scene.stat !== 'object' || Array.isArray(scene.stat)) fail('invalid_plan', `scenes[${index}].stat must be an object`);
      stat = {
        value: nonEmptyString(scene.stat.value, `scenes[${index}].stat.value`, 16),
        label: nonEmptyString(scene.stat.label, `scenes[${index}].stat.label`, 32),
      };
    }
    if (layout === 'stat' && !stat) fail('invalid_plan', `scenes[${index}].stat layout requires stat.value and stat.label`);
    if (layout === 'quote' && !body) fail('invalid_plan', `scenes[${index}].quote layout requires body`);

    let media;
    if (scene.media !== undefined) {
      if (!scene.media || scene.media.type !== 'image') fail('invalid_plan', `scenes[${index}].media only supports image`);
      const src = safeRelativeAsset(scene.media.src, `scenes[${index}].media.src`);
      if (!imagePattern.test(src)) fail('invalid_plan', `scenes[${index}].media.src has unsupported extension`);
      media = {type: 'image', src, fit: scene.media.fit ?? 'cover', alt: optionalString(scene.media.alt, `scenes[${index}].media.alt`, 160)};
      if (!['cover', 'contain'].includes(media.fit)) fail('invalid_plan', `scenes[${index}].media.fit must be cover or contain`);
      assets.push(src);
    }
    if (['split', 'full-media'].includes(layout) && !media) fail('invalid_plan', `scenes[${index}].${layout} layout requires local image media`);

    const job = jobsByScene.get(id);
    let durationInFrames;
    if (job) {
      if (scene.durationSeconds !== undefined) fail('invalid_plan', `scenes[${index}] has narration, so durationSeconds must be omitted and derived from audio`);
    } else {
      const durationSeconds = numberInRange(scene.durationSeconds, undefined, 1, 30, `scenes[${index}].durationSeconds`);
      durationInFrames = Math.max(1, Math.round(durationSeconds * raw.fps));
    }
    return {id, layout, eyebrow, title: sceneTitle, body, bullets, stat, media, job, durationInFrames};
  });

  let bgm = null;
  if (audio.bgm !== undefined && audio.bgm !== null) {
    if (!audio.bgm || typeof audio.bgm !== 'object' || Array.isArray(audio.bgm)) fail('invalid_plan', 'audio.bgm must be an object or null');
    const src = safeRelativeAsset(audio.bgm.src, 'audio.bgm.src');
    if (!audioPattern.test(src)) fail('invalid_plan', 'audio.bgm.src has unsupported extension');
    assets.push(src);
    bgm = {src, volume: volume(audio.bgm.volume, 0.16, 'audio.bgm.volume'), duckVolume: volume(audio.bgm.duckVolume, 0.06, 'audio.bgm.duckVolume')};
    if (bgm.duckVolume > bgm.volume) fail('invalid_plan', 'audio.bgm.duckVolume cannot exceed volume');
  }
  if (raw.coverFrame !== undefined && (!Number.isInteger(raw.coverFrame) || raw.coverFrame < 0)) {
    fail('invalid_plan', 'coverFrame must be a non-negative integer inside the video timeline');
  }
  return {
    title,
    template,
    theme,
    voiceover,
    jobs,
    scenes,
    assets,
    bgm,
    targetDurationSeconds,
    durationToleranceSeconds,
  };
};

const hasMp3Frame = (data) => {
  const limit = Math.min(data.length, 1024 * 1024);
  for (let index = 0; index + 4 <= limit; index += 1) {
    if (data[index] !== 0xff || (data[index + 1] & 0xe0) !== 0xe0) continue;
    const version = (data[index + 1] >> 3) & 0x03;
    const layer = (data[index + 1] >> 1) & 0x03;
    const bitrate = (data[index + 2] >> 4) & 0x0f;
    const sampleRate = (data[index + 2] >> 2) & 0x03;
    if (version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && sampleRate !== 3) return true;
  }
  return false;
};

const hasWavContainer = (data) => {
  if (data.length < 44 || data.subarray(0, 4).toString('ascii') !== 'RIFF' || data.subarray(8, 12).toString('ascii') !== 'WAVE') return false;
  let foundFormat = false;
  let foundData = false;
  for (let offset = 12; offset + 8 <= data.length;) {
    const chunkSize = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset, offset + 4).toString('ascii');
    if (chunk === 'fmt ' && chunkSize >= 16) foundFormat = true;
    if (chunk === 'data' && chunkSize > 0) foundData = true;
    const next = offset + 8 + chunkSize + (chunkSize % 2);
    if (next <= offset || next > data.length) break;
    offset = next;
  }
  return foundFormat && foundData;
};

const assertAudioContainerFormat = (file, format, label) => {
  const data = readFileSync(file);
  let valid = false;
  if (format === 'mp3') valid = hasMp3Frame(data);
  if (format === 'opus') valid = data.length >= 32 && data.subarray(0, 4).toString('ascii') === 'OggS' && data.subarray(0, Math.min(data.length, 4096)).includes(Buffer.from('OpusHead'));
  if (format === 'aac') {
    const frameLength = data.length >= 7 ? ((data[3] & 0x03) << 11) | (data[4] << 3) | (data[5] >> 5) : 0;
    valid = data.length >= 7 && data[0] === 0xff && (data[1] & 0xf6) === 0xf0 && frameLength >= 7 && frameLength <= data.length;
  }
  if (format === 'flac') {
    const streamInfoLength = data.length >= 8 ? (data[5] << 16) | (data[6] << 8) | data[7] : 0;
    valid = data.length >= 42 && data.subarray(0, 4).toString('ascii') === 'fLaC' && (data[4] & 0x7f) === 0 && streamInfoLength === 34;
  }
  if (format === 'wav') valid = hasWavContainer(data);
  if (!valid) fail('voiceover_format_mismatch', `${label} bytes do not match the requested ${format} container`);
};

const probeAudioDuration = async (file, runtime, label) => {
  const {ALL_FORMATS, EncodedPacketSink, FilePathSource, Input} = runtime.managedRequire('mediabunny');
  const input = new Input({formats: ALL_FORMATS, source: new FilePathSource(file)});
  try {
    if (!(await input.canRead())) fail('invalid_audio', `${label} is not a readable audio file`);
    const tracks = await input.getAudioTracks();
    if (tracks.length === 0) fail('invalid_audio', `${label} does not contain an audio track`);
    const track = tracks[0];
    if (typeof EncodedPacketSink !== 'function') fail('invalid_audio', `${label} cannot be inspected by the managed media runtime`);
    const codec = typeof track.getCodec === 'function' ? await track.getCodec() : null;
    const channels = typeof track.getNumberOfChannels === 'function' ? await track.getNumberOfChannels() : 0;
    const sampleRate = typeof track.getSampleRate === 'function' ? await track.getSampleRate() : 0;
    if (!codec || !Number.isInteger(channels) || channels < 1 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      fail('invalid_audio', `${label} has invalid audio track metadata`);
    }
    let packetCount = 0;
    let packetBytes = 0;
    const packetSink = new EncodedPacketSink(track);
    for await (const packet of packetSink.packets(undefined, undefined, {skipLiveWait: true})) {
      if (!Number.isFinite(packet?.timestamp) || !Number.isFinite(packet?.duration) || packet.duration < 0) {
        fail('invalid_audio', `${label} contains an invalid encoded audio packet`);
      }
      packetCount += 1;
      packetBytes += Number.isFinite(packet.byteLength) ? packet.byteLength : packet.data?.byteLength ?? 0;
    }
    if (packetCount === 0 || packetBytes <= 0) fail('invalid_audio', `${label} has no readable encoded audio packets`);
    const durationSeconds = await input.computeDuration(tracks, {skipLiveWait: true});
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      fail('invalid_audio', `${label} has no usable duration`);
    }
    return durationSeconds;
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    fail('invalid_audio', `cannot inspect ${label}: ${error.message}`);
  } finally {
    input.dispose();
  }
};

const readVoiceoverBinding = async (workspace, publicRoot, job, runtime) => {
  const bindingCandidate = path.join(workspace, ...job.binding.split('/'));
  if (!existsSync(bindingCandidate)) return null;
  try {
    const bindingPath = plainExistingPathWithin(workspace, bindingCandidate, 'file', `voiceover binding ${job.sceneId}`);
    const binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
    if (!binding || binding.version !== 1 || binding.sceneId !== job.sceneId || binding.jobHash !== job.jobHash || typeof binding.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(binding.sha256)) {
      fail('invalid_voiceover_binding', `voiceover binding for ${job.sceneId} does not match its script and TTS settings`);
    }
    const src = safeRelativeAsset(binding.src, `voiceover binding ${job.sceneId}.src`);
    const extension = path.posix.extname(src).slice(1).toLowerCase();
    const expectedSrc = `audio/narration/${binding.sha256.slice(0, 32)}.${job.format}`;
    if (!src.startsWith('audio/narration/') || !audioPattern.test(src) || extension !== job.format || src !== expectedSrc) {
      fail('invalid_voiceover_binding', `voiceover binding for ${job.sceneId} does not use the expected .${job.format} narration asset`);
    }
    const audioFile = plainExistingPathWithin(publicRoot, path.join(publicRoot, ...src.split('/')), 'file', `voiceover audio ${job.sceneId}`);
    if (statSync(audioFile).size > maxVoiceoverBytes) fail('invalid_voiceover_binding', `voiceover audio for ${job.sceneId} exceeds the 64 MiB limit`);
    if (sha256(audioFile) !== binding.sha256) fail('invalid_voiceover_binding', `voiceover audio for ${job.sceneId} failed integrity verification`);
    assertAudioContainerFormat(audioFile, job.format, `voiceover audio ${job.sceneId}`);
    const durationSeconds = await probeAudioDuration(audioFile, runtime, `voiceover audio ${job.sceneId}`);
    return {src, durationSeconds, sha256: binding.sha256};
  } catch (error) {
    if (error instanceof RunnerError && error.code === 'invalid_voiceover_binding') throw error;
    if (error instanceof RunnerError && error.code === 'unsafe_path') throw error;
    fail('invalid_voiceover_binding', `cannot verify voiceover binding for ${job.sceneId}: ${error.message}`);
  }
};

const loadPlanV1 = async (workspace, runtime) => {
  const planPath = plainExistingPathWithin(workspace, path.join(workspace, 'video-plan.json'), 'file', 'video plan');
  const publicRoot = plainExistingPathWithin(workspace, path.join(workspace, 'public'), 'directory', 'workspace public directory');
  let raw;
  try {
    raw = JSON.parse(readFileSync(planPath, 'utf8'));
  } catch (error) {
    fail('invalid_plan_json', `cannot parse ${planPath}: ${error.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_plan', 'video plan must be an object');
  if (raw.version !== 1) fail('invalid_plan', 'version must be 1');
  if (!slugPattern.test(raw.id ?? '')) fail('invalid_plan', 'id must be a lowercase slug with 1-63 characters');
  const title = nonEmptyString(raw.title, 'title', 120);
  if (!['16:9', '9:16', '1:1'].includes(raw.aspectRatio)) fail('invalid_plan', 'aspectRatio must be 16:9, 9:16 or 1:1');
  if (![24, 25, 30].includes(raw.fps)) fail('invalid_plan', 'fps must be 24, 25 or 30');
  if (!raw.theme || typeof raw.theme !== 'object') fail('invalid_plan', 'theme is required');
  const color = (key) => {
    const value = raw.theme[key];
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('invalid_plan', `theme.${key} must be #RRGGBB`);
    return value.toLowerCase();
  };
  if (!Array.isArray(raw.scenes) || raw.scenes.length < 1 || raw.scenes.length > 30) fail('invalid_plan', 'scenes must contain 1-30 items');
  const ids = new Set();
  const assets = [];
  let totalSeconds = 0;
  const scenes = raw.scenes.map((scene, index) => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) fail('invalid_plan', `scenes[${index}] must be an object`);
    const id = nonEmptyString(scene.id, `scenes[${index}].id`, 63);
    if (!slugPattern.test(id) || ids.has(id)) fail('invalid_plan', `scenes[${index}].id must be a unique slug`);
    ids.add(id);
    if (typeof scene.durationSeconds !== 'number' || !Number.isFinite(scene.durationSeconds) || scene.durationSeconds < 1 || scene.durationSeconds > 30) {
      fail('invalid_plan', `scenes[${index}].durationSeconds must be 1-30`);
    }
    totalSeconds += scene.durationSeconds;
    const normalized = {
      id,
      durationSeconds: scene.durationSeconds,
      durationInFrames: Math.max(1, Math.round(scene.durationSeconds * raw.fps)),
      layout: scene.media ? 'split' : (index === raw.scenes.length - 1 && index > 0 ? 'end-card' : 'hero'),
      eyebrow: optionalString(scene.eyebrow, `scenes[${index}].eyebrow`, 48),
      title: nonEmptyString(scene.title, `scenes[${index}].title`, 80),
      body: optionalString(scene.body, `scenes[${index}].body`, 180),
    };
    if (scene.media !== undefined) {
      if (!scene.media || scene.media.type !== 'image') fail('invalid_plan', `scenes[${index}].media only supports image`);
      const src = safeRelativeAsset(scene.media.src, `scenes[${index}].media.src`);
      if (!imagePattern.test(src)) fail('invalid_plan', `scenes[${index}].media.src has unsupported extension`);
      assets.push(src);
      normalized.media = {type: 'image', src, fit: scene.media.fit ?? 'cover', alt: optionalString(scene.media.alt, `scenes[${index}].media.alt`, 160)};
      if (!['cover', 'contain'].includes(normalized.media.fit)) fail('invalid_plan', `scenes[${index}].media.fit must be cover or contain`);
    }
    return normalized;
  });
  if (totalSeconds > 600) fail('invalid_plan', 'total duration cannot exceed 600 seconds');
  const narration = raw.audio?.narration ?? [];
  if (!Array.isArray(narration) || narration.length > 32) fail('invalid_plan', 'audio.narration must be an array with at most 32 tracks');
  const normalizedNarration = [];
  for (let index = 0; index < narration.length; index += 1) {
    const track = narration[index];
    if (!track || typeof track !== 'object') fail('invalid_plan', `audio.narration[${index}] must be an object`);
    const src = safeRelativeAsset(track.src, `audio.narration[${index}].src`);
    if (!audioPattern.test(src)) fail('invalid_plan', `audio.narration[${index}].src has unsupported extension`);
    const startSeconds = track.startSeconds ?? 0;
    const endSeconds = track.endSeconds ?? totalSeconds;
    if (![startSeconds, endSeconds].every((item) => typeof item === 'number' && Number.isFinite(item)) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds > totalSeconds) {
      fail('invalid_plan', `audio.narration[${index}] has invalid startSeconds/endSeconds`);
    }
    const candidate = path.join(publicRoot, ...src.split('/'));
    const audioFile = plainExistingPathWithin(publicRoot, candidate, 'file', `audio.narration[${index}].src`);
    const durationSeconds = await probeAudioDuration(audioFile, runtime, `audio.narration[${index}].src`);
    const availableFrames = Math.round((endSeconds - startSeconds) * raw.fps);
    const requiredFrames = Math.ceil(durationSeconds * raw.fps);
    if (requiredFrames > availableFrames) {
      fail(
        'narration_would_truncate',
        `audio.narration[${index}] is ${durationSeconds.toFixed(3)}s but its timeline window is only ${(endSeconds - startSeconds).toFixed(3)}s`,
        {
          src,
          durationSeconds,
          windowSeconds: endSeconds - startSeconds,
          requiredEndSeconds: startSeconds + requiredFrames / raw.fps,
        },
      );
    }
    assets.push(src);
    normalizedNarration.push({src, startSeconds, endSeconds, durationSeconds, volume: volume(track.volume, 1, `audio.narration[${index}].volume`)});
  }
  let bgm = null;
  if (raw.audio?.bgm !== undefined && raw.audio.bgm !== null) {
    const src = safeRelativeAsset(raw.audio.bgm.src, 'audio.bgm.src');
    if (!audioPattern.test(src)) fail('invalid_plan', 'audio.bgm.src has unsupported extension');
    assets.push(src);
    bgm = {src, volume: volume(raw.audio.bgm.volume, 0.16, 'audio.bgm.volume'), duckVolume: volume(raw.audio.bgm.duckVolume, 0.06, 'audio.bgm.duckVolume')};
    if (bgm.duckVolume > bgm.volume) fail('invalid_plan', 'audio.bgm.duckVolume cannot exceed volume');
  }
  for (const relative of assets) {
    const candidate = path.join(publicRoot, ...relative.split('/'));
    try {
      plainExistingPathWithin(publicRoot, candidate, 'file', `asset ${relative}`);
    } catch (error) {
      if (error instanceof RunnerError && error.code === 'invalid_path') fail('missing_asset', `asset does not exist: ${relative}`);
      throw error;
    }
  }
  // Remotion composes the individually rounded scene lengths, so coverFrame
  // must be checked against that same timeline rather than a second rounding
  // of the aggregate seconds.
  const totalFrames = scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0);
  const coverFrame = raw.coverFrame ?? Math.floor(totalFrames * 0.2);
  if (!Number.isInteger(coverFrame) || coverFrame < 0 || coverFrame >= totalFrames) fail('invalid_plan', 'coverFrame must be inside the video timeline');
  return {
    version: 1,
    id: raw.id,
    title,
    aspectRatio: raw.aspectRatio,
    fps: raw.fps,
    coverFrame,
    template: 'liwa-editorial',
    captions: {enabled: false},
    theme: {background: color('background'), foreground: color('foreground'), accent: color('accent'), muted: color('muted')},
    scenes,
    audio: {narration: normalizedNarration, bgm},
  };
};

const loadPlanV2 = async (workspace, runtime, raw) => {
  assertV2WorkspaceCapabilities(workspace);
  const publicRoot = plainExistingPathWithin(workspace, path.join(workspace, 'public'), 'directory', 'workspace public directory');
  const draft = validatePlanV2Draft(raw);
  const assets = [...draft.assets];
  const scenes = [];
  let totalFrames = 0;
  for (const scene of draft.scenes) {
    let durationInFrames = scene.durationInFrames;
    let narration;
    const {job} = scene;
    if (job) {
      const binding = await readVoiceoverBinding(workspace, publicRoot, job, runtime);
      if (!binding) {
        fail('voiceover_not_ready', `voiceover audio is missing for scene ${scene.id}; generate and stage this segment first`, {
          sceneId: scene.id,
          text: job.text,
          voice: job.voice,
          format: job.format,
          speed: job.speed,
          jobHash: job.jobHash,
        });
      }
      const timing = voiceTiming(binding.durationSeconds, raw.fps, draft.voiceover.leadInSeconds, draft.voiceover.tailSeconds);
      const {fromFrame, audioFrames} = timing;
      durationInFrames = timing.durationInFrames;
      if (durationInFrames > 30 * raw.fps) fail('voiceover_scene_too_long', `voiceover scene ${scene.id} exceeds 30 seconds; split its subtitle and narration into smaller scenes`);
      narration = {
        text: job.text,
        src: binding.src,
        volume: 1,
        fromFrame,
        durationInFrames: audioFrames,
        audioDurationSeconds: binding.durationSeconds,
      };
      assets.push(binding.src);
    }
    totalFrames += durationInFrames;
    scenes.push({
      id: scene.id,
      durationSeconds: durationInFrames / raw.fps,
      durationInFrames,
      layout: scene.layout,
      eyebrow: scene.eyebrow,
      title: scene.title,
      body: scene.body,
      bullets: scene.bullets,
      stat: scene.stat,
      media: scene.media,
      narration,
    });
  }
  if (totalFrames / raw.fps > 600) fail('invalid_plan', 'total duration cannot exceed 600 seconds');
  if (draft.targetDurationSeconds !== undefined) {
    const actualDurationSeconds = totalFrames / raw.fps;
    if (Math.abs(actualDurationSeconds - draft.targetDurationSeconds) > draft.durationToleranceSeconds) {
      fail('target_duration_mismatch', `resolved video is ${actualDurationSeconds.toFixed(3)}s, outside the ${draft.targetDurationSeconds}s target`, {
        targetDurationSeconds: draft.targetDurationSeconds,
        actualDurationSeconds,
        toleranceSeconds: draft.durationToleranceSeconds,
      });
    }
  }
  for (const relative of assets) {
    try {
      plainExistingPathWithin(publicRoot, path.join(publicRoot, ...relative.split('/')), 'file', `asset ${relative}`);
    } catch (error) {
      if (error instanceof RunnerError && error.code === 'invalid_path') fail('missing_asset', `asset does not exist: ${relative}`);
      throw error;
    }
  }
  const coverFrame = raw.coverFrame ?? Math.min(totalFrames - 1, Math.max(0, Math.round(raw.fps * 0.8)));
  if (!Number.isInteger(coverFrame) || coverFrame < 0 || coverFrame >= totalFrames) fail('invalid_plan', 'coverFrame must be inside the video timeline');
  return {
    version: 2,
    id: raw.id,
    title: draft.title,
    aspectRatio: raw.aspectRatio,
    fps: raw.fps,
    coverFrame,
    targetDurationSeconds: draft.targetDurationSeconds,
    template: draft.template,
    captions: {enabled: draft.jobs.length > 0 && draft.voiceover.showCaptions},
    theme: draft.theme,
    scenes,
    audio: {narration: [], bgm: draft.bgm},
  };
};

const loadPlan = async (workspace, runtime) => {
  const raw = readRawPlan(workspace);
  if (raw.version === 1) return loadPlanV1(workspace, runtime);
  if (raw.version === 2) return loadPlanV2(workspace, runtime, raw);
  fail('invalid_plan', 'version must be 1 or 2');
};

const artifactPaths = (generatedRoot, plan) => {
  const checks = path.join(generatedRoot, `${plan.id}-checks`);
  return {
    video: path.join(generatedRoot, `${plan.id}.mp4`),
    cover: path.join(generatedRoot, `${plan.id}-cover.png`),
    checks,
    first: path.join(checks, 'first.png'),
    middle: path.join(checks, 'middle.png'),
    last: path.join(checks, 'last.png'),
  };
};

const readPrefix = (file, length) => {
  const descriptor = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(descriptor, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
};

const validateRenderedArtifacts = (artifacts) => {
  if (!existsSync(artifacts.video)) return {rendered: false};
  for (const key of ['video', 'cover', 'first', 'middle', 'last']) {
    if (!existsSync(artifacts[key]) || !statSync(artifacts[key]).isFile()) fail('incomplete_render', `missing rendered artifact: ${artifacts[key]}`);
  }
  const mp4 = readPrefix(artifacts.video, 12);
  if (statSync(artifacts.video).size < 1024 || mp4.subarray(4, 8).toString('ascii') !== 'ftyp') fail('invalid_render', 'rendered video is not a valid MP4 container');
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const key of ['cover', 'first', 'middle', 'last']) {
    const value = readPrefix(artifacts[key], 8);
    if (statSync(artifacts[key]).size < 64 || !value.equals(pngMagic)) fail('invalid_render', `${key} is not a valid PNG`);
  }
  return {rendered: true, bytes: statSync(artifacts.video).size};
};

const removeRenderStaging = (generatedRoot, stagingRoot, planId) => {
  const root = plainDirectory(generatedRoot, 'generated video directory');
  const staging = path.resolve(stagingRoot);
  if (path.dirname(staging) !== root || !path.basename(staging).startsWith(`.render-${planId}-`)) {
    fail('unsafe_path', 'refusing to remove an unexpected render staging directory');
  }
  if (!existsSync(staging)) return;
  const info = lstatSync(staging);
  if (info.isSymbolicLink()) {
    rmSync(staging, {force: true});
    return;
  }
  if (!info.isDirectory() || realpathSync(staging) !== staging) {
    fail('unsafe_path', 'render staging path is not a plain directory');
  }
  rmSync(staging, {recursive: true, force: true});
};

// All expensive work happens in a sibling staging directory. The MP4 moves
// last and therefore acts as the completion marker visible to the UI.
const commitRenderedArtifacts = (staged, final) => {
  for (const target of [final.video, final.cover, final.checks]) {
    if (existsSync(target)) fail('output_exists', `rendered output already exists: ${target}`);
  }
  const committed = [];
  try {
    for (const [source, target] of [
      [staged.checks, final.checks],
      [staged.cover, final.cover],
      [staged.video, final.video],
    ]) {
      renameSync(source, target);
      committed.push(target);
    }
  } catch (error) {
    for (const target of committed.reverse()) rmSync(target, {recursive: true, force: true});
    if (error instanceof RunnerError) throw error;
    fail('commit_failed', `cannot publish rendered video: ${error.message}`);
  }
};

const initWorkspace = (options) => {
  const {projectRoot, videoProjectsRoot} = projectContext(options);
  const name = required(options, 'name');
  if (!slugPattern.test(name)) fail('invalid_name', 'name must be a lowercase slug with 1-63 characters');
  ensurePlainDirectoryWithin(projectRoot, videoProjectsRoot, 'video projects directory');
  const workspace = path.join(videoProjectsRoot, name);
  if (existsSync(workspace)) fail('workspace_exists', `workspace already exists: ${workspace}`);
  cpSync(templateRoot, workspace, {recursive: true, dereference: true, errorOnExist: true, force: false});
  const safeWorkspace = plainExistingPathWithin(videoProjectsRoot, workspace, 'directory', 'workspace');
  assertV2WorkspaceCapabilities(safeWorkspace);
  plainExistingPathWithin(safeWorkspace, path.join(safeWorkspace, 'src'), 'directory', 'workspace source directory');
  const publicRoot = ensurePlainDirectoryWithin(safeWorkspace, path.join(safeWorkspace, 'public'), 'workspace public directory');
  ensurePlainDirectoryWithin(publicRoot, path.join(publicRoot, 'assets'), 'workspace asset directory');
  ensurePlainDirectoryWithin(publicRoot, path.join(publicRoot, 'audio'), 'workspace audio directory');
  emit({ok: true, command: 'init', projectRoot, workspace: safeWorkspace, plan: path.join(safeWorkspace, 'video-plan.json')});
};

const stageAsset = (options) => {
  const {projectRoot, publicRoot} = workspaceContext(options);
  const inputRaw = required(options, 'input');
  if (!path.isAbsolute(inputRaw)) fail('invalid_path', 'input must be absolute');
  let input;
  try {
    input = plainExistingPathWithin(projectRoot, inputRaw, 'file', 'input');
  } catch (error) {
    if (error instanceof RunnerError && ['invalid_path', 'unsafe_path'].includes(error.code)) {
      fail('input_outside_project', 'input must be a plain regular file inside the current project');
    }
    throw error;
  }
  const destination = safeRelativeAsset(required(options, 'destination'), 'destination');
  if (!assetPattern.test(destination)) fail('unsupported_asset', 'destination has an unsupported media extension');
  const target = path.join(publicRoot, ...destination.split('/'));
  const bytes = copyPlainFileExclusive(input, target, publicRoot, `destination ${destination}`);
  emit({ok: true, command: 'stage', source: input, destination, bytes});
};

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const listVoiceoverJobs = async (options, runtime) => {
  const {workspace, publicRoot} = workspaceContext(options);
  const raw = readRawPlan(workspace);
  if (raw.version !== 2) fail('invalid_plan', 'voiceover-jobs requires a version 2 video plan');
  assertV2WorkspaceCapabilities(workspace);
  const {jobs} = validatePlanV2Draft(raw);
  const resolved = [];
  for (const job of jobs) {
    let binding;
    let issue;
    try {
      binding = await readVoiceoverBinding(workspace, publicRoot, job, runtime);
    } catch (error) {
      if (!(error instanceof RunnerError) || error.code !== 'invalid_voiceover_binding') throw error;
      issue = error.message;
    }
    resolved.push({
      sceneId: job.sceneId,
      text: job.text,
      voice: job.voice,
      format: job.format,
      speed: job.speed,
      jobHash: job.jobHash,
      ready: Boolean(binding),
      ...(binding ? {src: binding.src, durationSeconds: binding.durationSeconds} : {}),
      ...(issue ? {repairRequired: true, issue} : {}),
    });
  }
  emit({ok: true, command: 'voiceover-jobs', jobs: resolved});
};

const writeVoiceoverBinding = (workspace, bindingRelative, value) => {
  const bindingRoot = ensurePlainDirectoryWithin(workspace, path.join(workspace, '.voiceover-bindings'), 'voiceover binding directory');
  const target = path.join(workspace, ...bindingRelative.split('/'));
  if (!isInside(bindingRoot, target) || path.dirname(target) !== bindingRoot) fail('unsafe_path', 'voiceover binding escaped its directory');
  if (existsSync(target)) fail('voiceover_stage_race', 'another stage committed this voiceover job first; request voiceover-jobs again');
  let descriptor;
  let created = false;
  let completed = false;
  try {
    // Exclusive creation is the portable race barrier on NTFS, exFAT/FAT and
    // network shares. A crash can at worst leave a partial binding, which is
    // intentionally repairable by the next explicit stage-voiceover call.
    descriptor = openSync(target, 'wx', 0o600);
    created = true;
    const data = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    let offset = 0;
    while (offset < data.length) offset += writeSync(descriptor, data, offset, data.length - offset);
    closeSync(descriptor);
    descriptor = undefined;
    plainExistingPathWithin(bindingRoot, target, 'file', 'voiceover binding');
    completed = true;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created && !completed) rmSync(target, {force: true});
    if (error instanceof RunnerError) throw error;
    if (error?.code === 'EEXIST') fail('voiceover_stage_race', 'another stage committed this voiceover job first; request voiceover-jobs again');
    fail('voiceover_binding_failed', `cannot save voiceover binding: ${error.message}`);
  }
};

const removeInvalidVoiceoverBinding = (workspace, job) => {
  const bindingRoot = ensurePlainDirectoryWithin(workspace, path.join(workspace, '.voiceover-bindings'), 'voiceover binding directory');
  const target = path.join(workspace, ...job.binding.split('/'));
  if (!existsSync(target)) return;
  const bindingPath = plainExistingPathWithin(bindingRoot, target, 'file', `voiceover binding ${job.sceneId}`);
  let binding;
  try {
    binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
  } catch {
    // A malformed binding has no trustworthy asset reference to clean up.
  }
  if (binding && typeof binding.sha256 === 'string' && /^[0-9a-f]{64}$/.test(binding.sha256) && typeof binding.src === 'string') {
    const expected = `audio/narration/${binding.sha256.slice(0, 32)}.${job.format}`;
    if (binding.src === expected) {
      const publicRoot = path.join(workspace, 'public');
      const audioCandidate = path.join(publicRoot, ...expected.split('/'));
      try {
        const audio = plainExistingPathWithin(publicRoot, audioCandidate, 'file', `voiceover audio ${job.sceneId}`);
        if (sha256(audio) !== binding.sha256) rmSync(audio, {force: true});
      } catch (error) {
        if (error instanceof RunnerError && error.code === 'unsafe_path') throw error;
        // Missing or otherwise invalid content is already unusable; removing
        // the binding below is sufficient for the repair flow.
      }
    }
  }
  rmSync(bindingPath, {force: true});
};

const assertCurrentVoiceoverJob = (workspace, sceneId, expectedJobHash) => {
  const currentRaw = readRawPlan(workspace);
  if (currentRaw.version !== 2) fail('voiceover_job_changed', `video plan changed while staging scene ${sceneId}`);
  assertV2WorkspaceCapabilities(workspace);
  const currentDraft = validatePlanV2Draft(currentRaw);
  const currentJob = currentDraft.jobs.find((item) => item.sceneId === sceneId);
  if (!currentJob || currentJob.jobHash !== expectedJobHash) {
    fail('voiceover_job_changed', `voiceover job for scene ${sceneId} changed; discard this TTS result and request voiceover-jobs again`, {
      expectedJobHash,
      currentJobHash: currentJob?.jobHash,
    });
  }
  return currentJob;
};

const commitContentAddressedAudio = (temporary, publicRoot, checksum, extension) => {
  // Keep deeply nested Windows workspaces below legacy path limits while the
  // binding retains and verifies the complete SHA-256 value.
  const destination = `audio/narration/${checksum.slice(0, 32)}.${extension}`;
  const target = path.join(publicRoot, ...destination.split('/'));
  if (existsSync(target)) {
    const existing = plainExistingPathWithin(publicRoot, target, 'file', `voiceover destination ${destination}`);
    if (statSync(existing).size <= maxVoiceoverBytes && sha256(existing) === checksum) {
      rmSync(temporary, {force: true});
      return {destination, target: existing, reused: true};
    }
    fail('voiceover_content_conflict', `voiceover content-addressed destination is occupied by different bytes: ${destination}`);
  }
  try {
    renameSync(temporary, target);
  } catch (error) {
    // A different scene may concurrently publish the same content hash. The
    // bytes are interchangeable only after their full checksum is verified.
    if (existsSync(target)) {
      const existing = plainExistingPathWithin(publicRoot, target, 'file', `voiceover destination ${destination}`);
      if (statSync(existing).size <= maxVoiceoverBytes && sha256(existing) === checksum) {
        rmSync(temporary, {force: true});
        return {destination, target: existing, reused: true};
      }
    }
    throw error;
  }
  const committed = plainExistingPathWithin(publicRoot, target, 'file', `voiceover destination ${destination}`);
  if (sha256(committed) !== checksum) fail('voiceover_stage_failed', 'voiceover destination changed during commit');
  return {destination, target: committed, reused: false};
};

const stageVoiceover = async (options, runtime) => {
  const {projectRoot, workspace, publicRoot} = workspaceContext(options);
  const raw = readRawPlan(workspace);
  if (raw.version !== 2) fail('invalid_plan', 'stage-voiceover requires a version 2 video plan');
  assertV2WorkspaceCapabilities(workspace);
  const sceneId = required(options, 'scene-id');
  const requestedJobHash = required(options, 'job-hash');
  const {jobs} = validatePlanV2Draft(raw);
  const job = jobs.find((item) => item.sceneId === sceneId);
  if (!job) fail('voiceover_job_not_found', `scene ${sceneId} has no narration job in video-plan.json`);
  if (!/^[0-9a-f]{64}$/.test(requestedJobHash) || requestedJobHash !== job.jobHash) {
    fail('voiceover_job_changed', `voiceover job for scene ${sceneId} changed; discard this TTS result and request voiceover-jobs again`, {
      requestedJobHash,
      currentJobHash: job.jobHash,
    });
  }
  let result;
  let temporary;
  try {
    let existing;
    try {
      existing = await readVoiceoverBinding(workspace, publicRoot, job, runtime);
    } catch (error) {
      if (!(error instanceof RunnerError) || error.code !== 'invalid_voiceover_binding') throw error;
      // Explicit stage is the repair boundary: discard only the exact managed
      // binding and regenerate it from a newly verified TTS file.
      removeInvalidVoiceoverBinding(workspace, job);
    }
    if (existing) {
      result = {ok: true, command: 'stage-voiceover', sceneId, jobHash: job.jobHash, alreadyReady: true, destination: existing.src, durationSeconds: existing.durationSeconds, sha256: existing.sha256};
    } else {
      const inputRaw = required(options, 'input');
      if (!path.isAbsolute(inputRaw)) fail('invalid_path', 'input must be absolute');
      let input;
      try {
        input = plainExistingPathWithin(projectRoot, inputRaw, 'file', 'voiceover input');
      } catch (error) {
        if (error instanceof RunnerError && ['invalid_path', 'unsafe_path'].includes(error.code)) fail('input_outside_project', 'voiceover input must be a plain regular file inside the current project');
        throw error;
      }
      if (statSync(input).size > maxVoiceoverBytes) fail('asset_too_large', 'voiceover input exceeds the 64 MiB limit');
      const extension = path.extname(input).slice(1).toLowerCase();
      if (extension !== job.format) fail('voiceover_format_mismatch', `scene ${sceneId} expects ${job.format} audio but received .${extension || '<none>'}`);
      const narrationRoot = ensurePlainDirectoryWithin(publicRoot, path.join(publicRoot, 'audio', 'narration'), 'voiceover narration directory');
      temporary = path.join(narrationRoot, `.stage-${process.pid}-${Date.now()}-${randomBytes(8).toString('hex')}.${extension}`);
      const bytes = copyPlainFileExclusive(input, temporary, publicRoot, `temporary voiceover for ${sceneId}`, maxVoiceoverBytes);
      assertAudioContainerFormat(temporary, job.format, `voiceover audio ${sceneId}`);
      const durationSeconds = await probeAudioDuration(temporary, runtime, `voiceover audio ${sceneId}`);
      const checksum = sha256(temporary);
      assertCurrentVoiceoverJob(workspace, sceneId, requestedJobHash);
      const committed = commitContentAddressedAudio(temporary, publicRoot, checksum, extension);
      temporary = undefined;
      writeVoiceoverBinding(workspace, job.binding, {
        version: 1,
        sceneId,
        jobHash: job.jobHash,
        src: committed.destination,
        sha256: checksum,
        durationSeconds,
      });
      result = {ok: true, command: 'stage-voiceover', sceneId, jobHash: job.jobHash, destination: committed.destination, durationSeconds, bytes, sha256: checksum, reused: committed.reused};
    }
  } finally {
    if (temporary) rmSync(temporary, {force: true});
  }
  // Emission intentionally happens after the binding commit and outside the
  // cleanup scope. A broken stdout consumer must never roll back valid media.
  emit(result);
};

const stageBgm = (options, runtime) => {
  const {publicRoot} = workspaceContext(options);
  const trackId = required(options, 'track-id');
  const catalogPath = plainExistingPathWithin(runtime.bgmRoot, path.join(runtime.bgmRoot, 'catalog.json'), 'file', 'BGM catalog');
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  } catch (error) {
    fail('invalid_bgm_catalog', `cannot parse BGM catalog: ${error.message}`);
  }
  const track = Array.isArray(catalog.tracks) ? catalog.tracks.find((item) => item?.id === trackId) : undefined;
  if (!track) fail('bgm_not_found', `built-in BGM track is unavailable: ${trackId}`);
  for (const field of ['title', 'filename', 'author', 'license', 'source', 'sha256']) {
    if (typeof track[field] !== 'string' || track[field].trim() === '') fail('invalid_bgm_catalog', `track ${trackId} is missing ${field}`);
  }
  if (!/^[0-9a-f]{64}$/.test(track.sha256) || typeof track.durationSeconds !== 'number' || track.durationSeconds <= 0) fail('invalid_bgm_catalog', `track ${trackId} has invalid copyright or integrity metadata`);
  const filename = safeRelativeAsset(track.filename, `track ${trackId} filename`);
  const source = plainExistingPathWithin(runtime.bgmRoot, path.join(runtime.bgmRoot, ...filename.split('/')), 'file', `BGM track ${trackId}`);
  if (sha256(source) !== track.sha256) fail('invalid_bgm_catalog', `track ${trackId} failed integrity verification`);
  const destination = `audio/bgm-${track.id}${path.extname(track.filename).toLowerCase()}`;
  const target = path.join(publicRoot, ...destination.split('/'));
  const bytes = copyPlainFileExclusive(source, target, publicRoot, `BGM destination ${destination}`);
  emit({ok: true, command: 'stage-bgm', track: {id: track.id, title: track.title, author: track.author, license: track.license, source: track.source}, destination, bytes});
};

const summarizePlan = (plan) => {
  let cursor = 0;
  const timeline = plan.scenes.map((scene) => {
    const fromFrame = cursor;
    cursor += scene.durationInFrames;
    return {
      id: scene.id,
      layout: scene.layout,
      fromFrame,
      durationInFrames: scene.durationInFrames,
      ...(scene.narration ? {
        narrationFromFrame: fromFrame + scene.narration.fromFrame,
        narrationDurationInFrames: scene.narration.durationInFrames,
        audioDurationSeconds: scene.narration.audioDurationSeconds,
      } : {}),
    };
  });
  return {
    id: plan.id,
    version: plan.version,
    template: plan.template,
    aspectRatio: plan.aspectRatio,
    fps: plan.fps,
    scenes: plan.scenes.length,
    voiceoverSegments: plan.scenes.filter((scene) => scene.narration).length,
    captionsEnabled: plan.captions?.enabled === true,
    totalFrames: cursor,
    durationSeconds: cursor / plan.fps,
    timeline,
  };
};

const validate = async (options, runtime) => {
  const {workspace, generatedRoot} = workspaceContext(options);
  const plan = await loadPlan(workspace, runtime);
  const artifacts = artifactPaths(generatedRoot, plan);
  emit({ok: true, command: 'validate', plan: summarizePlan(plan), artifacts: validateRenderedArtifacts(artifacts)});
};

const render = async (options, runtime) => {
  const {projectRoot, workspace, publicRoot, generatedRoot} = workspaceContext(options);
  const plan = await loadPlan(workspace, runtime);
  const finalArtifacts = artifactPaths(generatedRoot, plan);
  if ([finalArtifacts.video, finalArtifacts.cover, finalArtifacts.checks].some(existsSync)) fail('output_exists', `rendered output already exists for ${plan.id}`);
  const safeGeneratedRoot = ensurePlainDirectoryWithin(projectRoot, generatedRoot, 'generated video directory');
  const stagingRoot = mkdtempSync(path.join(safeGeneratedRoot, `.render-${plan.id}-`));
  const stagedArtifacts = artifactPaths(stagingRoot, plan);
  ensurePlainDirectoryWithin(stagingRoot, stagedArtifacts.checks, 'render checks directory');
  try {
    const entryPoint=plainExistingPathWithin(workspace,path.join(workspace,'src','index.ts'),'file','Remotion entry point');
    const prepared=await prepareComposition({entryPoint,publicDir:publicRoot,inputProps:plan,id:'EcnuVideo',runtime,onProgress:(stage,percent)=>progress(stage,Math.round(percent),'准备视频')});
    const {composition}=prepared;
    const frames = {
      first: Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(plan.fps * 0.5))),
      middle: Math.floor((composition.durationInFrames - 1) / 2),
      last: composition.durationInFrames - 1,
    };
    for (const [name, frame] of Object.entries(frames)) {
      progress('stills', Math.round(((Object.keys(frames).indexOf(name) + 1) / 4) * 100), `正在渲染${name}质检帧`);
      await renderFrame(prepared,{frame,output:stagedArtifacts[name]});
    }
    progress('stills', 100, '正在渲染封面');
    await renderFrame(prepared,{frame:plan.coverFrame,output:stagedArtifacts.cover});
    progress('video', 0, '正在渲染 MP4');
    await renderComposition(prepared,{output:stagedArtifacts.video,signal:runtime.signal,onProgress:(_,value)=>progress('video',Math.round(value),'渲染视频')});
    validateRenderedArtifacts(stagedArtifacts);
    commitRenderedArtifacts(stagedArtifacts, finalArtifacts);
    emit({ok: true, command: 'render', plan: summarizePlan(plan), outputs: finalArtifacts, validation: validateRenderedArtifacts(finalArtifacts)});
  } finally {
    removeRenderStaging(safeGeneratedRoot, stagingRoot, plan.id);
  }
};

export const dispatchVideoCommand = async (command, options, runtime) => {
  if (command === 'init') return initWorkspace(options);
  if (command === 'stage') return stageAsset(options);
  if (command === 'voiceover-jobs') return listVoiceoverJobs(options, runtime);
  if (command === 'stage-voiceover') return stageVoiceover(options, runtime);
  if (command === 'stage-bgm') return stageBgm(options, runtime);
  if (command === 'validate') return validate(options, runtime);
  if (command === 'render') return render(options, runtime);
  fail('usage', `unknown command: ${command}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  videoCLI().catch((error) => {
    const known = error instanceof RunnerError;
    process.stderr.write(`${JSON.stringify({type: 'error', code: known ? error.code : 'unexpected_error', message: error.message, details: known ? error.details : undefined})}\n`);
    process.exitCode = 1;
  });
}

export {
  RunnerError,
  commitRenderedArtifacts,
  copyPlainFileExclusive,
  loadPlan,
  listVoiceoverJobs,
  plainExistingPathWithin,
  removeRenderStaging,
  sourceVoiceoverJobs,
  stageBgm,
  stageVoiceover,
  summarizePlan,
  validatePlanV2Draft,
  voiceoverJobHash,
};

export async function runVideoCommand(command,options,runtime) {
  let result
  await commandContext.run({result:value=>{result=value}},()=>dispatchVideoCommand(command,options,runtime))
  return result
}
export async function videoCLI() {
  const {command,options}=parseArgs(process.argv.slice(2))
  await dispatchVideoCommand(command,options,process.env.ECNU_AGENT_NODE_ROOT?assertManagedRuntime():await createMediaRuntime())
}
export {probeAudioDuration,initWorkspace,assertManagedRuntime};
