import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { superviseInstalledStartup } from './installed-startup-check.mjs'
import { checkInstalledProgramTarget, removeInstalledData, rememberInstallerSource, waitForInstalledProcesses } from './installed-files.mjs'

async function main() {
  const { values, tokens } = parseArgs({ tokens: true, options: { action: { type: 'string' }, distribution: { type: 'string' },
    'program-root': { type: 'string' }, 'source-root': { type: 'string' }, wait: { type: 'boolean' }, uninstall: { type: 'boolean' } } })
  const names = tokens.filter(token => token.kind === 'option').map(token => token.name)
  if (new Set(names).size !== names.length) throw new Error('安装参数重复，已停止操作')
  if (values.action === 'check-program') {
    await checkInstalledProgramTarget({ programRoot: values['program-root'], distribution: values.distribution, uninstall: values.uninstall })
  } else if (values.action === 'check-running') {
    await waitForInstalledProcesses({ programRoot: values['program-root'], sourceRoot: values['source-root'], wait: values.wait, uninstall: values.uninstall })
  } else if (values.action === 'verify-startup') {
    const programRoot = values['program-root']
    await checkInstalledProgramTarget({ programRoot, distribution: values.distribution })
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const startup = await superviseInstalledStartup({
      start: argument => spawn(join(programRoot, 'EduWork-Electron.exe'), ['--updated', argument],
        { cwd: programRoot, env, stdio: 'ignore' }),
      waitForStop: () => waitForInstalledProcesses({ programRoot, wait: true }),
    })
    if (!startup.ready) {
      console.error(startup.failure)
      process.exitCode = 10
    }
  } else if (values.action === 'remember-source') {
    await rememberInstallerSource({ programRoot: values['program-root'], sourceRoot: values['source-root'], distribution: values.distribution })
  } else if (values.action === 'remove-data' && !values['program-root']) {
    await removeInstalledData({ distribution: values.distribution })
  } else throw new Error('不支持的安装数据操作')
}
void main().catch(error => { console.error(error.message); process.exitCode = 1 })
