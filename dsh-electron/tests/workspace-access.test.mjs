import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startNativeBridge } from '../src/native-vault.mjs'
import { repairWorkspaceAccess } from '../src/workspace-access.mjs'

async function fixture(t, { status = 'missing-write-owner', response = 0, repairError, save } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'workspace-access-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const path = join(base, 'workspace'), root = join(base, 'app'), out = join(base, 'logs')
  const dialogs = [], calls = [], logs = [], controller = new AbortController()
  const before = { status, fingerprint: 'a'.repeat(64), before: 'D:(synthetic)', path }
  const options = { root, productName: 'EduWork', out, signal: controller.signal, log: text => logs.push(text), save,
    showMessageBox: async value => { dialogs.push(value); return { response } },
    run: async (_helper, args, signal) => {
      calls.push({ args, signal })
      if (args[0] === 'check-workspace-access') return before
      assert.equal((await readdir(out)).length, 1, 'snapshot must be saved before mutation')
      if (repairError) throw repairError
      return { status: 'repaired', path, before: before.before, after: 'D:(synthetic WO)' }
    } }
  return { path, root, out, dialogs, calls, logs, options, controller }
}

test('usable or unsupported ACLs do not prompt or repair', async t => {
  for (const status of ['ready', 'unsupported']) {
    const f = await fixture(t, { status })
    assert.deepEqual(await repairWorkspaceAccess(f.path, f.options), { repaired: false })
    assert.equal(f.calls.length, 1); assert.equal(f.dialogs.length, 0)
  }
})

test('declining, cancellation and protected application paths never mutate permissions', async t => {
  const f = await fixture(t, { response: 1 })
  assert.deepEqual(await repairWorkspaceAccess(f.path, f.options), { repaired: false })
  assert.equal(f.calls.length, 1)
  assert.equal(f.dialogs[0].defaultId, f.dialogs[0].cancelId)
  await repairWorkspaceAccess(join(f.root, 'data'), f.options)
  assert.equal(f.calls.length, 1)
  f.controller.abort()
  await repairWorkspaceAccess(f.path, f.options)
  assert.equal(f.calls.length, 1)
})

test('a confirmed repair persists the snapshot then binds the write to its fingerprint', async t => {
  const f = await fixture(t)
  assert.deepEqual(await repairWorkspaceAccess(f.path, f.options), { repaired: true })
  assert.deepEqual(f.calls[1].args, ['repair-workspace-access', '--root', f.path, '--expected', 'a'.repeat(64)])
  assert.equal(f.calls[1].signal, undefined, 'do not kill a transaction midway on request disconnect')
  assert.equal((await readdir(f.out)).length, 2)
})

test('backup failure prevents repair and helper failure preserves the saved snapshot', async t => {
  const f = await fixture(t, { save: async () => { throw new Error('synthetic disk full') } })
  assert.deepEqual(await repairWorkspaceAccess(f.path, f.options), { repaired: false })
  assert.equal(f.calls.length, 1)
  const changed = await fixture(t, { repairError: new Error('workspace changed') })
  assert.deepEqual(await repairWorkspaceAccess(changed.path, changed.options), { repaired: false })
  assert.equal((await readdir(changed.out)).length, 2)
  assert.equal(changed.dialogs.at(-1).type, 'error')
})

test('authenticated bridge rejects malformed paths and supplies cancellation', async t => {
  const calls = []
  const bridge = await startNativeBridge({ vault: { flush: async () => {} }, workspaceAccess: async (path, signal) => { calls.push({ path, signal }); return { repaired: false } } })
  t.after(() => bridge.close())
  const path = join(tmpdir(), 'synthetic-workspace')
  const request = (body, token = bridge.bootstrap.nativeBridge.token) => fetch(bridge.bootstrap.nativeBridge.baseURL + '/v1/desktop/workspace-access', {
    method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(body),
  })
  assert.equal((await request({ path }, 'invalid')).status, 403)
  for (const body of [null, {}, { path: 'relative' }, { path, extra: true }]) assert.equal((await request(body)).status, 400)
  assert.equal(calls.length, 0)
  assert.equal((await request({ path })).status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, path)
  assert.ok(calls[0].signal instanceof AbortSignal)
})

test('real HTTP disconnect aborts native workspace request while waiting', async () => {
  let release, enteredResolve, observedSignal
  const entered = new Promise(resolve => { enteredResolve=resolve })
  const bridge = await startNativeBridge({vault:{flush:async()=>{}}, workspaceAccess:async(path, signal) => {
    observedSignal=signal;enteredResolve();await new Promise(resolve=>{release=resolve});return {repaired:false}
  }})
  const controller = new AbortController()
  const request = fetch(bridge.bootstrap.nativeBridge.baseURL+'/v1/desktop/workspace-access',{
    method:'POST',headers:{authorization:'Bearer '+bridge.bootstrap.nativeBridge.token},
    body:JSON.stringify({path:join(tmpdir(),'synthetic-review')}),signal:controller.signal,
  }).catch(e=>e)
  try {
    await entered
    assert.equal(observedSignal.aborted,false)
    controller.abort()
    await request
    for(let i=0;i<25&&!observedSignal.aborted;i++)await new Promise(resolve=>setTimeout(resolve,20))
    assert.equal(observedSignal.aborted,true)
  } finally {release?.();await bridge.close()}
})

test('abandoning native confirmation makes subsequent confirm harmless', async () => {
  const area = await mkdtemp(join(tmpdir(),'workspace-access-review-'))
  const controller = new AbortController(), calls=[], records=[]
  try {
    const outcome = await repairWorkspaceAccess(join(area,'workspace'),{
      productName:'Synthetic',root:join(area,'application'),out:join(area,'logs'),signal:controller.signal,
      run:async(_helper,args)=>{calls.push(args[0]);return {status:'missing-write-owner',fingerprint:'a'.repeat(64),before:'D:(synthetic)'}},
      showMessageBox:async()=>{controller.abort();return {response:0}},
      save:async(...args)=>records.push(args),log:()=>{},
    })
    assert.deepEqual(outcome,{repaired:false})
    assert.deepEqual(calls,['check-workspace-access'])
    assert.deepEqual(records,[])
  } finally {await rm(area,{recursive:true,force:true})}
})
