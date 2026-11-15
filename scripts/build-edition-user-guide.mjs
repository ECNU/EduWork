import { readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { childPath, isMainModule } from './lib/build-util.mjs'

const template = new URL('../dsh-plugins/user-guide/guide/index.html', import.meta.url)
const images = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }
const escapeText = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

// Both pages are assembled from source on each build, including repeat builds.
// The installed reader continues to serve static HTML with its usual sandbox.
export async function buildEditionUserGuide(edition, guide, runtime, destination = join(runtime, 'node_modules/@eduwork/dsh-user-guide/guide')) {
  if (!guide) return
  const root = await realpath(edition)
  const source = await realpath(childPath(root, guide.source))
  childPath(root, relative(root, source))
  const sourceUrl = new URL(guide.sourceUrl)
  if (sourceUrl.protocol !== 'https:') throw Error('userGuide.sourceUrl must be an HTTPS link to the source document')
  const require = createRequire(join(runtime, 'package.json'))
  const { micromark } = await import(pathToFileURL(require.resolve('micromark')).href)
  const { gfm, gfmHtml } = await import(pathToFileURL(require.resolve('micromark-extension-gfm')).href)
  const { parse } = require('node-html-parser')
  const content = parse(micromark(await readFile(source, 'utf8'), { extensions: [gfm()], htmlExtensions: [gfmHtml()] }))
  const title = content.querySelector('h1')?.textContent.trim()
  if (!title) throw Error('The edition user guide needs a top-level title')

  for (const link of content.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href')
    if (href.startsWith('#')) continue
    const url = new URL(href, sourceUrl)
    if (!href || !['https:', 'http:', 'mailto:'].includes(url.protocol)) throw Error('Unsupported link in edition user guide')
    link.setAttribute('href', url.href)
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }
  for (const image of content.querySelectorAll('img')) {
    const src = image.getAttribute('src')
    if (!src || /^(?:[a-z]+:|[/\\])/i.test(src)) throw Error('Guide images must be local edition files')
    const path = await realpath(resolve(dirname(source), decodeURIComponent(src)))
    childPath(root, relative(root, path))
    const mime = images[extname(path).toLowerCase()]
    if (!mime) throw Error('Unsupported guide image: ' + src)
    image.setAttribute('src', 'data:' + mime + ';base64,' + (await readFile(path)).toString('base64'))
  }
  const entries = content.querySelectorAll('h2').map((heading, index) => {
    const id = 'chapter-' + (index + 1)
    heading.setAttribute('id', id)
    return '<li><a href="#' + id + '">' + escapeText(heading.textContent) + '</a></li>'
  })

  const layout = await readFile(template, 'utf8')
  const common = parse(layout)
  const school = parse(layout)
  school.querySelector('title').innerHTML = escapeText(title)
  school.querySelector('nav ol').innerHTML = entries.join('')
  school.querySelector('main').innerHTML = '<article class="edition-guide">' + content.toString() + '</article>'
  school.querySelector('nav').insertAdjacentHTML('beforeend', '<p><a class="guide-switch" href="./general.html">查看通用教程</a></p>')
  common.querySelector('nav').insertAdjacentHTML('beforeend', '<p><a class="guide-switch" href="./index.html">返回发行版指南</a></p>')
  await writeFile(join(destination, 'general.html'), common.toString())
  await writeFile(join(destination, 'index.html'), school.toString())
}

if (isMainModule(import.meta.url)) {
  const [edition, source, sourceUrl, runtime] = process.argv.slice(2)
  await buildEditionUserGuide(edition, { source, sourceUrl }, runtime)
}
