import {execFileSync} from 'node:child_process'
import {dirname, join} from 'node:path'
import {existsSync} from 'node:fs'
export function npm(args, options={}) {
  const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')]
  const cli=candidates.find(p=>p&&existsSync(p))
  if(!cli)throw new Error('Run this script through npm, or use a Node distribution containing npm.')
  return execFileSync(process.execPath,[cli,...args],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,...options})
}
