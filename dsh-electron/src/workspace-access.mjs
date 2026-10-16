import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'

const runHelper = (helper, args, signal) => new Promise((resolve, reject) => execFile(helper, args,
  { windowsHide: true, ...(args[0] === 'check-workspace-access' ? { timeout: 15_000, signal } : {}), encoding: 'utf8' },
  (error, stdout) => {
    if (error) {
      try { error.nativeResult = JSON.parse(stdout) } catch {}
      reject(error); return
    }
    try { resolve(JSON.parse(stdout)) } catch (error) { reject(error) }
  }))

function within(path, root) {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// The Host requests this only after the official sandbox fails to grant its
// registered workspace. Recheck the missing right before offering any change.
export async function repairWorkspaceAccess(path, { productName, root, protectedRoots = [], out, showMessageBox, log, signal, run = runHelper, save = writeFile }) {
  const helper = join(root, 'resources/update/EduWork-Updater.exe')
  if ([root, ...protectedRoots].some(blocked => within(path, blocked)) || signal?.aborted) return { repaired: false }
  let record
  try {
    const before = await run(helper, ['check-workspace-access', '--root', path], signal)
    if (before.status !== 'missing-write-owner' || !/^[a-f0-9]{64}$/.test(before.fingerprint) || typeof before.before !== 'string' || signal?.aborted) return { repaired: false }
    const { response } = await showMessageBox({
      type: 'warning', title: productName, buttons: ['调整权限', '暂不调整'], defaultId: 1, cancelId: 1,
      message: '工作区沙箱需要补充一项 Windows 权限',
      detail: `沙箱为下列工作区设置隔离权限时被 Windows 拒绝，检查确认当前账户拥有该文件夹，但缺少设置完整性标签所需的权限：\n\n${path}\n\n`
        + '调整只为当前 Windows 账户补充此文件夹的 WRITE_OWNER 权限，不授予完全控制，不改变所有者，不清理其他应用的权限，也不递归修改子目录。\n\n'
        + `确认后保存原权限记录到：\n${out}\n\n完成后可再次发起任务；不会自动重新执行刚才的命令。`,
    })
    if (response !== 0 || signal?.aborted) return { repaired: false }
    await mkdir(out, { recursive: true })
    const plannedRecord = join(out, `workspace-${randomUUID()}.json`)
    // No mutation before the original permissions are durably recorded.
    await save(plannedRecord, JSON.stringify({ version: 1, time: new Date().toISOString(), before }, null, 2) + '\n', { flag: 'wx', flush: true })
    record = plannedRecord
    if (signal?.aborted) return { repaired: false }
    // Once the short native transaction starts, let it verify/rollback and
    // record the result even if the requesting Host closes its connection.
    const result = await run(helper, ['repair-workspace-access', '--root', path, '--expected', before.fingerprint])
    await save(record + '.result.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx', flush: true })
    if (result.status !== 'repaired') throw new Error('Workspace permission repair did not verify')
    log(`[desktop:workspace-access] root WRITE_OWNER verified; sandbox command requires a new attempt; record=${record}\n`)
    if (!signal?.aborted) await showMessageBox({ type: 'info', title: productName, message: '已补充工作区权限',
      detail: '现在可以再次发起任务。刚才失败的命令没有自动重新执行；下一次执行仍使用原有沙箱隔离。' })
    return { repaired: true }
  } catch (error) {
    if (record) await save(record + '.error.json', JSON.stringify({ status: 'failed', message: error.message, nativeResult: error.nativeResult ?? null }, null, 2) + '\n', { flag: 'wx', flush: true })
      .catch(failure => log(`[desktop:workspace-access] could not save repair failure: ${failure.message}\n`))
    if (signal?.aborted) return { repaired: false }
    log(`[desktop:workspace-access] ${error.message}\n`)
    await showMessageBox({ type: 'error', title: productName, message: '未能完成工作区权限检查或调整',
      detail: `请保留原错误信息。处理记录（如已创建）保存在：\n${out}\n\n也可以改用自己“文档”文件夹中的工作区。不会关闭沙箱或请求管理员权限。` })
    return { repaired: false }
  }
}
