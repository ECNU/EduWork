import { rename } from 'node:fs/promises'
import { childPath, isDirectory, pathExists } from './build-util.mjs'

/** Resolve the archive's application name from the product identity. */
export function desktopApplicationName({ edition, platform, sourceAlpha = false }) {
  if (!['EduWork', 'EduWork-ECNU'].includes(edition)) throw new Error('Unknown desktop edition')
  if (platform === 'win32') return edition
  if (platform === 'darwin') return `${edition}${sourceAlpha ? ' Alpha' : ''}.app`
  throw new Error('Unsupported desktop install platform')
}

/** Move the extracted application into a new install target without replacing it. */
export async function installPreparedApplication({ staging, installRoot, applicationName }) {
  const source = childPath(staging, applicationName)
  const target = childPath(installRoot, applicationName)
  if (!await isDirectory(source)) throw new Error(`Extracted application is missing: ${applicationName}`)
  if (await pathExists(target)) throw new Error(`Install target already exists and is never replaced: ${target}`)
  await rename(source, target)
  return target
}
