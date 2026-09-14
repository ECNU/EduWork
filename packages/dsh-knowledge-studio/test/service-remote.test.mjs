import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeStudioService } from '../lib/index.js'
import { TYPERT } from '../lib/typert.host.js'
import { knowledgeStudioRemote } from '../src/client/remote.ts'

test('host and mounted client agree on every remote parameter', () => {
  const shape = descriptors => descriptors.map(item => ({
    method: item.method, parameters: item.parameters.map(parameter => parameter.name),
  }))
  assert.deepEqual(shape(TYPERT.invocations), shape(knowledgeStudioRemote.descriptors))
})

test('remote methods tolerate the proxy receiver used by the Typert gateway', async () => {
  const workspace = { id: 'workspace-1', title: 'Workspace', path: 'C:/workspace' }
  const target = Object.assign(Object.create(KnowledgeStudioService.prototype), {
    ctx: {
      artifactServices: {ready: Promise.resolve(),mediaReadiness:async()=>({available:true})},
      workspaceRegistry: {
        get: id => id === workspace.id ? workspace : undefined,
        resolveByPath: async path => path === workspace.path ? workspace : undefined,
      },
    },
    settingsScope: {
      get: () => ({ maxTextFileBytes: 10, maxPdfFileBytes: 20, maxFiles: 30 }),
    },
    manager: {
      status: () => { throw new Error('Workspace polling must not open the retired knowledge workflow') },
      readEvidence: async (_workspace, evidenceId) => ({ evidenceId, content: 'saved evidence' }),
    },
    artifacts: { list: async () => [] },
    registry: { list: () => [] },
    mediaProviders: { describe: async () => ({speech:[],music:[]}) },
  })
  const receiver = new Proxy(target, {})

  const snapshot = await KnowledgeStudioService.prototype.workspaceForPath.call(
    receiver,
    workspace.path,
  )
  assert.equal(snapshot.id, workspace.id)
  assert.deepEqual(Object.keys(snapshot).sort(), ['artifacts', 'capabilities', 'id', 'path', 'title'])
  const evidence = await KnowledgeStudioService.prototype.readEvidence.call(receiver, workspace.id, 'evidence-1')
  assert.equal(evidence.evidence.evidenceId, 'evidence-1')
  for (const method of ['prepare', 'cancelTask', 'search', 'wiki', 'readWikiPage', 'clear']) {
    assert.equal(typeof KnowledgeStudioService.prototype[method], 'undefined')
    assert.equal(TYPERT.invocations.some(item => item.method === method), false)
  }
})
