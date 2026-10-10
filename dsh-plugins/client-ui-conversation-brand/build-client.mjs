// Builds the ChatECNU Work Conversation derivative: product hero copy, the
// release-stage badge and (on older DSH runtimes) the unified add-control
// seat. Node.js port of build-client.ps1.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { capture, copyFileTo, ensureDir, fullPath, isFile, isMainModule, readJSON, removeTree } from '../../scripts/lib/build-util.mjs'
import { parseBuilderArgs } from '../../scripts/lib/client-build.mjs'
import { normalizeGeneratedClient } from '../../scripts/normalize-generated-client.mjs'

const upstreamPackage = '@deepseek-ai/dsh-client-ui-conversation'
const productPackage = '@chatecnu-work/dsh-client-ui-conversation-brand'

export async function buildClient({ upstream = '', runtimePackages = '', dshLockPath = '', output = '', version = '0.1.0-dev' } = {}) {
  const scriptRoot = fullPath(dirname(fileURLToPath(import.meta.url)))
  const repository = fullPath(join(scriptRoot, '..', '..'))
  upstream = fullPath(upstream || join(repository, '.research/upstream/deepseek-harness'))
  if (!dshLockPath) dshLockPath = join(repository, 'third_party/dsh/LOCK.json')
  if (!version) version = '0.1.0-dev'
  const lock = await readJSON(dshLockPath)
  let source
  if (runtimePackages) {
    const runtimePackage = join(fullPath(runtimePackages), upstreamPackage)
    const manifest = await readJSON(join(runtimePackage, 'package.json'))
    if (String(manifest.version) !== String(lock.packageVersion)) {
      throw new Error(`Official DSH Conversation package version mismatch: expected ${lock.packageVersion}, got ${manifest.version}`)
    }
    source = join(runtimePackage, 'lib')
  } else {
    const { testDshCompatibility } = await import(pathToFileURL(join(repository, 'dsh-desktop/scripts/test-dsh-compatibility.mjs')).href)
    await testDshCompatibility({ upstream, lockPath: dshLockPath })
    source = join(upstream, 'packages/client/ui-conversation/lib')
  }
  const target = output ? fullPath(output) : join(scriptRoot, 'lib')
  if (!target.startsWith(repository + sep)) throw new Error('Conversation output must stay within the repository')
  if (!await isFile(join(source, 'client.js'))) throw new Error(`Locked DSH Conversation build is unavailable: ${source}`)
  await removeTree(target)
  await ensureDir(target)
  for (const artifact of ['index.js', 'client.js']) {
    await copyFileTo(join(source, artifact), join(target, artifact))
  }

  const clientPath = join(target, 'client.js')
  let client = await readFile(clientPath, 'utf8')
  const identityCount = client.split(upstreamPackage).length - 1
  if (identityCount < 1) throw new Error(`Conversation package identity anchor changed: client.js (${identityCount} matches)`)
  client = client.replaceAll(upstreamPackage, productPackage)

  const releaseIdentity = JSON.parse(await capture(process.execPath, [
    join(repository, 'dsh-host/release-policy.mjs'), version, String(lock.packageVersion),
  ]).catch(() => { throw new Error('Invalid product release identity') }))
  const replacements = [
    ['"hero.headline": "探索未至之境"', '"hero.headline": "今天想一起完成什么？"'],
    ['"hero.preview": "预览版"', `"hero.preview": "${releaseIdentity.badge.zh}"`],
    ['"hero.headline": "Into the Unknown"', '"hero.headline": "What shall we accomplish today?"'],
    ['"hero.preview": "Preview"', `"hero.preview": "${releaseIdentity.badge.en}"`],
  ]
  for (const [before, after] of replacements) {
    const count = client.split(before).length - 1
    if (count !== 1) throw new Error(`Conversation copy compatibility anchor changed: ${before} (${count} matches)`)
    client = client.replace(before, () => after)
  }

  // The build policy supplies a development/public-beta/release badge while
  // preserving the locked upstream DOM and the optional empty-label behavior.
  // 0.1.5 keeps the same hero node but emits adjacent JSX children on one line.
  // Anchor the unique previewBadge node rather than bundler indentation.
  const badgePattern = /\(0, react_jsx_runtime\.jsx\)\("span", \{\s*className: HeroShell_module_css_default\.previewBadge,\s*children: t\("hero\.preview"\)\s*\}\)/g
  const badgeMatches = [...client.matchAll(badgePattern)]
  if (badgeMatches.length !== 1) throw new Error(`Conversation hero badge compatibility anchor changed (${badgeMatches.length} matches)`)
  const badge = badgeMatches[0]
  const productBadge = badge[0].replace(
    '(0, react_jsx_runtime.jsx)("span", {',
    't("hero.preview") === "" ? null : (0, react_jsx_runtime.jsx)("span", {',
  )
  client = client.slice(0, badge.index) + productBadge + client.slice(badge.index + badge[0].length)

  // DSH 0.1.3 provides native generic-file intake. Do not install the legacy
  // add-control override or its document-level drop handler on that runtime.
  const nativeFileIntake = !/^0\.1\.[012](?:-|$)/.test(String(lock.packageVersion))
  if (!nativeFileIntake) {
    // Older DSH exposes the resident plus button only as a command-menu launcher,
    // while its attachment surface accepts images only. Replace that one resident
    // control with a single product child seat: the product file plugin can offer
    // ordinary workspace import and then hand images/commands straight back to
    // the locked Conversation intake. Without a registrant, the official control
    // remains the fallback.
    const attachmentChildPattern = /^(?<indent>\t*)"conversation\.input\.attachments": \{\r?\n\k<indent>\tkind: "single",\r?\n\k<indent>\tscope: "session-maybe"\r?\n\k<indent>\},/gm
    const attachmentChildMatches = [...client.matchAll(attachmentChildPattern)]
    if (attachmentChildMatches.length !== 1) throw new Error(`Conversation add-control child anchor changed (${attachmentChildMatches.length} matches)`)
    const attachmentChildMatch = attachmentChildMatches[0]
    const childIndent = attachmentChildMatch.groups.indent
    const addChild = '\n' + childIndent + '"conversation.input.add": {' +
      '\n' + childIndent + '\tkind: "single",' +
      '\n' + childIndent + '\tscope: "session-maybe"' +
      '\n' + childIndent + '},'
    const insertAt = attachmentChildMatch.index + attachmentChildMatch[0].length
    client = client.slice(0, insertAt) + addChild + client.slice(insertAt)

    const nativeAddPattern = /\(0, react_jsx_runtime\.jsx\)\(_deepseek_ai_dsh_client_ui_primitives\.Tooltip, \{\s*label: t\("input\.commands"\),[\s\S]*?\}\)(?=,\s*\(0, react_jsx_runtime\.jsxs\)\("div", \{\s*className: InputBar_module_css_default\.modes)/g
    const nativeAddMatches = [...client.matchAll(nativeAddPattern)]
    if (nativeAddMatches.length !== 1) throw new Error(`Conversation native add-control anchor changed (${nativeAddMatches.length} matches)`)
    const nativeAdd = nativeAddMatches[0]
    const seatIndent = '\t'.repeat(10)
    const productAdd = 'renderSlot("conversation.input.add", {' + '\n' +
      seatIndent + 'sessionId,' + '\n' +
      seatIndent + 'input,' + '\n' +
      seatIndent + 'inputActions,' + '\n' +
      seatIndent + 'locked,' + '\n' +
      seatIndent + 'onAddImages: intakeImages,' + '\n' +
      seatIndent + 'insertReference: (reference) => {' + '\n' +
      seatIndent + '\tconst snapshot = keyboard?.snapshot;' + '\n' +
      seatIndent + '\tif (snapshot === undefined || typeof keyboard?.insertReference !== "function") return false;' + '\n' +
      seatIndent + '\tconst span = keyboard.caretSpan();' + '\n' +
      seatIndent + '\treturn keyboard.insertReference(reference, { ...span, draftRev: snapshot.draftRev });' + '\n' +
      seatIndent + '},' + '\n' +
      seatIndent + 'openCommands: onToggleCommandMenu,' + '\n' +
      seatIndent + 'commandMenuOpen,' + '\n' +
      seatIndent + 'notify: showToast' + '\n' +
      '\t'.repeat(9) + '}) ?? ' + nativeAdd[0]
    client = client.slice(0, nativeAdd.index) + productAdd + client.slice(nativeAdd.index + nativeAdd[0].length)
    const addSlotDeclarationCount = (client.match(/^\s*"conversation\.input\.add": \{\s*$/gm) ?? []).length
    if (addSlotDeclarationCount !== 1) throw new Error(`Conversation add-control must have exactly one child declaration (${addSlotDeclarationCount} found)`)
  } else if (!client.includes('onAddFiles: intakeFiles')) {
    throw new Error('Expected native generic-file intake is missing from this DSH build')
  }

  await writeFile(clientPath, client)
  await normalizeGeneratedClient(target)
  console.log('Built ChatECNU Work Conversation derivative with product copy and unified add-control seat.')
}

if (isMainModule(import.meta.url)) {
  const { upstream, runtimePackages, dshLockPath, output, version } = parseBuilderArgs()
  await buildClient({ upstream, runtimePackages, dshLockPath, output, version })
}
