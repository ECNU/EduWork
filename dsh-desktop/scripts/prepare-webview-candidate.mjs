// Candidate-only diagnostics seam. Never edits the Go module cache or go.mod.
import { cp, readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'

const expected = '6013bea6dc614888de282a37febebdfb31984377b317b3911671b20209b8b671'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const { values } = parseArgs({ options: { module: { type: 'string' }, output: { type: 'string' } } })
if (!values.module || !values.output) throw new Error('Use --module <go-webview2 v1.0.22 source> --output <new build directory>')
const source = resolve(values.module), output = resolve(values.output)
const original = await readFile(join(source, 'pkg/edge/chromium.go'))
if (hash(original) !== expected) throw new Error('go-webview2 candidate source does not match locked v1.0.22')
await mkdir(output, { recursive: false })
const target = join(output, 'go-webview2')
await cp(source, target, { recursive: true, errorOnExist: true, force: false })
const before = '\tbrowserArgs := strings.Join(e.AdditionalBrowserArgs, " ")'
const text = original.toString('utf8')
if (text.split(before).length !== 2) throw new Error('WebView diagnostic patch target changed')
const patched = text.replace(before, `${before}
\tdiagnosticArgs, diagnosticErr := eduworkDesktopCDPArgs(os.Getenv("EDUWORK_DESKTOP_CDP_PORT"))
\tif diagnosticErr != nil { return false }
\tbrowserArgs += diagnosticArgs`)
const helper = `//go:build windows

package edge

import ("fmt"; "strconv")

// Explicit test-only loopback CDP. Normal user launches have no debugging port.
func eduworkDesktopCDPArgs(value string) (string, error) {
    if value == "" { return "", nil }
    port, err := strconv.Atoi(value)
    if err != nil || port < 1024 || port > 65535 || strconv.Itoa(port) != value {
        return "", fmt.Errorf("EDUWORK_DESKTOP_CDP_PORT must be an integer from 1024 to 65535")
    }
    return fmt.Sprintf(" --remote-debugging-address=127.0.0.1 --remote-debugging-port=%d", port), nil
}
`
const helperTest = `//go:build windows

package edge
import "testing"
func TestEduworkCDPIsExplicitAndLoopbackOnly(t *testing.T) {
    if value, err := eduworkDesktopCDPArgs(""); err != nil || value != "" { t.Fatal("debugging enabled by default") }
    if value, err := eduworkDesktopCDPArgs("9334"); err != nil || value != " --remote-debugging-address=127.0.0.1 --remote-debugging-port=9334" { t.Fatal("wrong debug binding", value, err) }
    for _, value := range []string{"0", "80", "65536", "+9334", "09334", "9334 --no-sandbox", "9334 --remote-debugging-address=0.0.0.0"} {
        if _, err := eduworkDesktopCDPArgs(value); err == nil { t.Fatal("invalid argument accepted", value) }
    }
}
`
// The Go module cache is read-only; only our private copy becomes writable.
await chmod(join(target, 'pkg/edge/chromium.go'), 0o644)
await writeFile(join(target, 'pkg/edge/chromium.go'), patched)
await writeFile(join(target, 'pkg/edge/eduwork_candidate.go'), helper)
await writeFile(join(target, 'pkg/edge/eduwork_candidate_test.go'), helperTest)
await writeFile(join(output, 'webview-candidate-receipt.json'), JSON.stringify({
  schemaVersion: 1, module: 'github.com/wailsapp/go-webview2', version: 'v1.0.22',
  goSum: 'h1:YT61F5lj+GGaat5OB96Aa3b4QA+mybD0Ggq6NZijQ58=',
  source: { path: 'pkg/edge/chromium.go', sha256: expected },
  outputs: { 'pkg/edge/chromium.go': hash(patched), 'pkg/edge/eduwork_candidate.go': hash(helper), 'pkg/edge/eduwork_candidate_test.go': hash(helperTest) },
  scope: 'candidate-only-modfile; explicit loopback CDP environment integer; no production module changes',
}, null, 2) + '\n')
console.log('Prepared candidate-only WebView diagnostics dependency.')
