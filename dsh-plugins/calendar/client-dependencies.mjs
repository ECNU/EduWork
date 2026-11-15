/** 从插件编译锁准备打包到客户端的依赖及其许可。宿主无需安装这些包。 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runBundledCli } from '../../scripts/lib/build-util.mjs'

export async function installCalendarClientDependencies(directory) {
  await runBundledCli('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory })
}

export async function calendarClientLicenseBanner(directory) {
  const { packages } = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'))
  const notices = []
  for (const [path, entry] of Object.entries(packages)) {
    if (!path) continue
    const packageDirectory = join(directory, path)
    const files = (await readdir(packageDirectory)).filter(name => /^(licen[cs]e|notice)(\.|$)/i.test(name)).sort()
    const texts = await Promise.all(files.map(name => readFile(join(packageDirectory, name), 'utf8')))
    notices.push(`${path.replace(/^.*node_modules\//, '')} ${entry.version} (${entry.license})\n${texts.join('\n')}`)
  }
  return `/*!\n${notices.join('\n\n').replaceAll('*/', '* /')}\n*/\n`
}
