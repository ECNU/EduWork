import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('client exposes an additive toolbar entry and keeps retired knowledge views out of the client', async () => {
  const [source, bundle, manifest, remote] = await Promise.all([
    Promise.all(['index.tsx','StudioEntry.tsx','WorkspaceHome.tsx','StudioArtifact.tsx','KnowledgeMarkdown.tsx'].map(file=>readFile(new URL('../src/client/'+file, import.meta.url),'utf8'))).then(parts=>parts.join('\n')),
    readFile(new URL('../lib/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../src/client/remote.ts', import.meta.url), 'utf8'),
  ])

  for (const pattern of [
    /slots\.inject\(\s*'details'/,
    /name:\s*'details',[\s\S]*?priority:\s*-50/,
    /data-knowledge-studio-entry/,
    /conversation\.session\.header\.utilities/,
    /aria-pressed=\{active\}/,
    /data-knowledge-studio-capability/,
    /data-knowledge-studio-details/,
    /sessions\.list\.subscribe\(\s*syncCurrentSession/,
    /surface\.enter\(\{ sessionId: current/,
    /service\.workspaceForPath\(cwd\)/,
    /service\.invokeStudio\(/,
    /service\.readArtifact\(artifactId\)/,
    /service\.updateArtifactInteraction\(/,
    /data-knowledge-studio-artifact/,
    /role="dialog"/,
    /inputActions\.setDraft\(result\.prompt\)/,
    /import ReactMarkdown,\s*\{\s*defaultUrlTransform\s*\} from 'react-markdown'/,
    /import remarkGfm from 'remark-gfm'/,
  ]) assert.match(source, pattern)

  for (const rejected of [
    'conversation.session.header.actions',
    'conversation.input.dock',
    'data-knowledge-studio-status',
    'data-knowledge-studio-welcome',
    'data-knowledge-studio-consent',
    'WikiReader',
    'WikiProgress',
    'service.prepare(',
    'service.search(',
    'service.wiki(',
    'service.readWikiPage(',
    "slots.inject('sidebar.footer.action'",
    "slots.inject('settings.section'",
    'data-knowledge-studio-overlay',
    'data-knowledge-studio-welcome-dialog',
    'openStudio',
    'autoPrepare',
    '我的笔记本',
    'addWorkspaceSource',
    'retrievalMode',
  ]) assert.equal(source.includes(rejected), false, `client source still contains rejected concept ${rejected}`)

  assert.match(remote, /service: 'knowledgeStudio'/)
  assert.match(remote, /descriptor\('workspaceForPath'/)
  assert.doesNotMatch(remote, /descriptor\('(prepare|cancelTask|search|wiki|readWikiPage|clear)'/)
  assert.doesNotMatch(bundle, /WikiReader|WikiProgress|工作区 Wiki|wiki-plan/)
  assert.match(bundle, /shell\.overlay/)
  assert.match(bundle, /data-knowledge-studio-details/)
  assert.doesNotMatch(bundle, /require\(["']node:/, 'browser client bundle must not retain Node built-in imports')
  assert.equal(manifest.name, '@eduwork/dsh-knowledge-studio')
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-dev\.\d{8}\.\d+)?$/)
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar'), false)
})
