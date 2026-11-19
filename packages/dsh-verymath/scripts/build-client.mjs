#!/usr/bin/env node
// 把浏览器半侧（client/*.js）复制成 lib/client.js。
//
// 为什么只复制、不打包：DSH 的客户端插件产物是
// `window.__ModuleLoader__.load({ id, factory })` 包一层的 CJS 工厂，平台表里已经
// 提供 react / react-dom / ui-primitives。本包没有 tsdown/vite，也不该为一个面板
// 引入构建链——`client/verymath.js` 就是可直接执行的源码，复制过去即可。
//
// 两个校验（比"复制成功"更重要）：
//   1. 产物 id 必须与 package.json 的 name 一致，否则宿主注册不上；
//   2. 语法必须能过 `node --check`（浏览器里解析失败时宿主只显示一行错误，很难查）。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const source = join(root, 'client', 'verymath.js')
const target = join(root, 'lib', 'client.js')

let pkg
let code
try {
  pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  code = await readFile(source, 'utf8')
} catch (error) {
  console.error(`build-client 读不到输入：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const declared = /id:\s*'([^']+)'/.exec(code)?.[1]
if (declared !== pkg.name) {
  console.error(`client bundle 的 id（${declared ?? '未找到'}）与 package.json 的 name（${pkg.name}）不一致`)
  process.exit(1)
}

const checked = await new Promise((resolvePromise) => {
  const child = spawn(process.execPath, ['--check', source], { stdio: ['ignore', 'pipe', 'pipe'] })
  const stderr = []
  child.stderr.on('data', (chunk) => stderr.push(chunk))
  child.on('close', (code_) => resolvePromise({ code: code_ ?? -1, stderr: Buffer.concat(stderr).toString() }))
})
if (checked.code !== 0) {
  console.error(`client bundle 语法不合法：${checked.stderr.slice(0, 400)}`)
  process.exit(1)
}

await mkdir(dirname(target), { recursive: true })
await writeFile(target, code)
console.log(`client bundle → lib/client.js（${(code.length / 1024).toFixed(1)} KB，id=${declared}）`)
