// Fixed rules in front of the decision model. A hit does not refuse anything: it marks the request as a kind of
// operation that is only approved when the user asked for it, and the decision model is told which part of the
// command set the rule off. The patterns are coarse on purpose; a false hit costs one extra confirmation.
//   ruleMatch(text) -> { name, part } for the first rule that matches, or null.
//   executedPart(command) -> the command without the text it only writes into files.

const P = String.raw
const re = parts => new RegExp(parts.join('|'), 'i')
// Command position, roughly. Quotes and brackets count because scripts hold commands in strings:
// execSync(`pkill …`), subprocess.run(["kill", …]).
const START = P`(?:^|[\s;&|(\`'"\[])`

// Shell start-up files, package-manager and git settings, ~/.config, app preferences and the agents' own permission
// settings.
const CONFIG = P`(?:~|\$HOME|\$\{HOME\}|/Users\/[^/\s"']+)/(?:\.(?:zshrc|zprofile|zshenv|zlogin|bashrc|bash_profile|profile|npmrc|yarnrc|gitconfig|condarc|curlrc|wgetrc)\b|\.config/|\.homebrew/|Library/Preferences/|\.claude/settings|\.codex/config\.toml)`

// Ending a process has no rule of its own: agents mostly stop the servers and emulators they started. The decision
// model's harm question asks whether a command stops a program the agent did not start.
const ASK = [
  ['推送和发布', re([
    P`\bgit\b[^\n;&|]*\s(?<!stash\s)push\b`,
    P`\bgh\s+(?:pr\s+(?:create|merge|close|reopen|comment|edit|review|ready)|issue\s+(?:create|comment|close|reopen|edit|delete)|release\s+(?:create|upload|edit|delete)|repo\s+(?:create|delete|edit|fork|rename)|workflow\s+run|run\s+(?:rerun|cancel|delete)|secret|variable)\b`,
    P`\bgh\s+api\b[^\n;&|]*(?:-X\s*|--method[\s=]+)(?:POST|PUT|PATCH|DELETE)\b`,
    P`\bgh\s+api\s+graphql\b[^\n]*\bmutation\b`,
    P`\b(?:npm|pnpm|yarn)\s+publish\b|\btwine\s+upload\b|\b(?:docker|podman)\s+push\b|\bcargo\s+publish\b`,
  ])],
  ['远程连接', re([
    P`${START}(?:ssh|scp|sftp|telnet|nc|ncat)\s`,
    P`\brsync\b[^\n;&|]*\s[\w.-]+@?[\w.-]*:(?!//)`,
    P`\b(?:Enter-PSSession|New-PSSession)\b|\bInvoke-Command\b[^\n;]*-ComputerName`,
  ])],
  ['上传', null], // per segment, see upload()
  ['运行部署或发布脚本', null], // per segment, see releaseScript()
  ['钥匙串和凭据', re([
    P`\bsecurity\s+(?:find-|dump-|export|unlock|add-|delete-|set-)`,
    P`\bgit\s+credential\b|\bgh\s+auth\s+token\b|\bcmdkey\b|\bvaultcmd\b|Get-StoredCredential`,
    P`(?:^|[\s'"=/])\.(?:ssh/|netrc\b|git-credentials\b|pypirc\b|aws/credentials|docker/config\.json)`,
    P`\bid_(?:rsa|ed25519|ecdsa)\b|(?:^|[\s/'"=])\.env(?!\.(?:example|sample|template)\b)(?:\.\w+)?\b|[/\\](?:Cookies|Login Data)\b`,
    P`(?:^|[;&|]\s*)(?:env|printenv)\s*(?:$|[|;&>])|\bprintenv\s+\w*(?:KEY|TOKEN|SECRET|PASS)`,
    // A shell expanding a secret variable. Upper-case names only: lower-case ones are mostly loop and template
    // variables (`$key`, `${token}`).
    P`\$\{?(?-i:[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASS)[A-Z0-9_]*)\b`,
    P`\b(?:Get-ChildItem|gci|dir|ls)\s+env:|\$env:\w*(?:KEY|TOKEN|SECRET|PASS)|\b(?:Get-Item|Get-Content|gi|gc)\s+env:\w*(?:KEY|TOKEN|SECRET|PASS)`,
  ])],
  ['sudo 和提权', re([P`${START}(?:sudo|doas)\s`, P`${START}su\s+-`, P`-Verb\s+RunAs\b`, P`${START}runas\s`])],
  ['安装', null], // see install()
  // Other programs' settings. Reads such as `npm config get` and `git config --global --list` do not count.
  ['改软件配置', re([
    P`\b(?:npm|pnpm|yarn|pip3?|uv|conda|poetry|bundle)\s+config\s+(?:set|unset|delete|rm|edit)\b|\bgo\s+env\s+-w\b`,
    P`\bgit\s+config\s+(?:--global|--system)\b(?![^\n;&|]*\s(?:--get\b|--get-all\b|--list\b|-l\b))`,
    P`(?:>>?|\btee\s+(?:-a\s+)?|\bsed\s+-i\S*\s[^\n;&|]*?)\s*["']?${CONFIG}`,
    P`\b(?:cp|mv|ln|install|ditto)\s[^\n;&|]*\s["']?${CONFIG}[^\s;&|'"]*["']?\s*(?:$|[;&|\n])`,
  ])],
  ['系统设置', re([
    P`\bdefaults\s+(?:write|delete|import)\b|\blaunchctl\s+(?:load|unload|bootstrap|bootout|enable|disable|submit|remove|setenv)\b|${START}crontab\s`,
    // Only the forms that change something; `scutil --proxy`, `pmset -g`, `spctl --assess`, `diskutil list` are reads.
    P`\b(?:systemsetup|networksetup)\s+-set|\bscutil\s+--set\b|\bpmset\s+(?!-g\b)\S|\bnvram\s+(?:-[dc]\b|\S+=)`,
    P`\bspctl\s+--(?:master|global)-(?:disable|enable)|\bspctl\s+--(?:add|remove|enable|disable)\b|\bcsrutil\s+(?:disable|enable|clear)\b`,
    P`\btccutil\s+reset\b|\bdiskutil\s+(?!list\b|info\b|apfs\s+list\b)\w|\b(?:bless|kextload|chsh)\b`,
    P`\bxattr\s+-[a-z]*[dc]|\bhdiutil\s+(?:attach|detach|eject)\b|\bdd\s[^\n]*of=/dev|${START}(?:mount|umount)\s`,
    P`\b(?:reg(?:\.exe)?\s+(?:add|delete|import|load)|Set-ItemProperty|New-ItemProperty|Remove-ItemProperty)\b[^\n;]*(?:HK(?:LM|CU|CR|U)\b|Registry::)`,
    P`\bSet-ExecutionPolicy\b|\bnetsh\b|\b(?:New|Set|Remove)-NetFirewall|\b(?:Register|Unregister)-ScheduledTask\b`,
    P`\bschtasks\b[^\n]*/(?:create|delete|change)|\bsc(?:\.exe)?\s+(?:create|config|delete|stop|start)\b`,
    P`\b(?:Set|Stop|Start|New)-Service\b|\bbcdedit\b|\b(?:Enable|Disable)-WindowsOptionalFeature\b|\b(?:Set|Add)-MpPreference\b|${START}setx\s`,
  ])],
]

const INSTALL = re([
  P`\b(?:npm|pnpm)\s+(?:i|install|add|uninstall|rm|remove|update)\b[^\n;&|]*(?:\s-g\b|--global)`,
  P`\byarn\s+global\s+(?:add|remove)\b|\bbrew\s+(?:install|uninstall|reinstall|upgrade|tap|untap|link|unlink|services)\b`,
  P`\b(?:gem|cargo|pipx)\s+install\b|\bgo\s+install\b|\buv\s+tool\s+install\b`,
  P`\b(?:apt|apt-get|dnf|yum|pacman|snap|port)\s+(?:install|remove|purge|upgrade)\b|\b(?:winget|choco|scoop)\s+(?:install|uninstall|upgrade)\b`,
  P`\b(?:Install|Uninstall|Update)-(?:Module|Package|Script)\b|\bAdd-AppxPackage\b|\binstaller\s+-pkg\b`,
  // Downloaded text piped in as the program; `| python3 -c '…'` only reads it as data.
  P`\b(?:curl|wget)\b[^\n|;]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da)?sh|python3?|node|perl|ruby)\b(?!(?:\s+-[A-Za-z]\b)*\s+-[ce]\b)`,
  P`\b(?:iex|Invoke-Expression)\b`,
])
// pip inside a virtual environment installs nothing system-wide.
const PIP = new RegExp(P`${START}(?:sudo\s+)?pip3?\s+(?:install|uninstall)\b|\bpython3?\s+-m\s+pip\s+(?:install|uninstall)\b`, 'i')
function install(text) {
  return text.match(INSTALL)?.[0] ?? (/venv/i.test(text) ? undefined : text.match(PIP)?.[0])
}

const SENDS = re([
  P`\bcurl\b[^\n]*?\s(?:-X\s*|--request[\s=]+)(?:POST|PUT|PATCH|DELETE)\b`,
  P`\bwget\b[^\n]*?\s--(?:post-data|post-file|method[\s=]+(?:POST|PUT|PATCH|DELETE))`,
  P`\b(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^\n]*?\s-(?:Method\s+['"]?(?:Post|Put|Patch|Delete)|Body|InFile|Form)\b`,
])
// curl's short options are case-sensitive (`-D` dumps headers, `-d` sends data), so these are matched without the i
// flag. A short option may carry its value directly (`-dvalue`, `-Tfile`).
const CURL_SENDS = new RegExp(P`\b[Cc]url\b[^\n]*?\s(?:-[dFT]|(?:--data(?:-\w+)?|--form|--upload-file|--json)[\s=])`)
const URL = /https?:\/\/[^\s'"`)]+/gi
const LOOPBACK = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:[/?#]|$)/i
function upload(text) {
  // Sending to this machine (local test servers) is not sending data out; a target we cannot see counts as remote.
  return split(text).find(seg => (SENDS.test(seg) || CURL_SENDS.test(seg)) && !(seg.match(URL)?.every(u => LOOPBACK.test(u)) ?? false))
}

// Running a script named for deploying, releasing or publishing. When the script's content is attached, the other
// rules see what it does; the name still counts for scripts that cannot be read. The name after the keyword stops at
// the next keyword, where the match can start instead, so the time stays linear in the length of the segment.
const RELEASE_SCRIPT = /^(?:\w+=\S*\s+)*(?:(?:ba|z|da)?sh\s+|source\s+|\.\s+|pwsh\s+(?:-File\s+)?|node\s+|python3?\s+(?:-I\s+)?)?["']?[^\s;&|"']*?(?:deploy|release|publish)(?:(?!deploy|release|publish)[\w.-])*\.(?:sh|ps1|py|mjs|js|ts)\b/i
function releaseScript(text) {
  return split(text).find(seg => RELEASE_SCRIPT.test(seg) && !/^(?:ba|z|da)?sh\s+-n\b/.test(seg))
}

// Forms of .env that do not expose it: loading it into the program being run (--env-file), creating or filling it,
// copying a template over it, testing that it exists, listing it in .gitignore. Reading or sending it still counts.
const ENV_SAFE = /--env-file(?:-if-exists)?[= ]\S+|>>?\s*["']?[\w./-]*\.env\b|\bcp\s+(?:-\w+\s+)*\S+\s+["']?[\w./-]*\.env["']?(?=\s*(?:$|[;&|)]))|\bchmod\s+\S+\s+["']?[\w./-]*\.env\b|\[\s+-[efs]\s+["']?[\w./-]*\.env["']?\s+\]|["']?\^?\.env\$?["']?\s*>>?\s*\S*\.gitignore|\.env["']?\s+\S*\.gitignore/g

export function ruleMatch(text) {
  for (const [name, rx] of ASK) {
    const t = name === '钥匙串和凭据' ? text.replace(ENV_SAFE, ' ') : text
    const hit = (name === '上传' ? upload(t) : name === '运行部署或发布脚本' ? releaseScript(t) : name === '安装' ? install(t) : t.match(rx)?.[0])?.replace(/^[\s;&|(`'"[]/, '')
    if (hit) return { name, part: split(t).find(seg => seg.includes(hit)) ?? hit }
  }
  return null
}

// Later uses of a written script that do not run it: making it executable, a syntax check, a linter, reading it.
const NOT_RUN = /^(?:chmod|shellcheck|cat|head|tail|wc|ls|stat|file|diff|grep|rg|git\s+(?:add|diff|status)|(?:ba|z|da)?sh\s+-n)\b/
// Text a command only writes into files is not run: the body of a heredoc fed to cat/tee, and triple-quoted strings in
// inline Python, so PR bodies and docs that mention push or ssh are not commands. A heredoc piped on to another program,
// or written to a non-text file that the rest of the command then runs, still counts, and so does a heredoc whose
// delimiter is unquoted and whose body holds a command substitution, which the shell runs.
export function executedPart(cmd) {
  const lines = cmd.split('\n'), trimmed = lines.map(line => line.trim()), out = []
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i])
    const m = lines[i].match(/<<-?\s*(['"]?)(\w+)\1/)
    if (!m) continue
    const end = trimmed.indexOf(m[2], i + 1)
    if (end < 0) continue
    const before = lines[i].slice(0, m.index), after = lines[i].slice(m.index + m[0].length)
    const body = lines.slice(i + 1, end).join('\n')
    const file = before.match(/(?:>>?|\btee\s+(?:-a\s+)?)\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/)
    const name = file && (file[1] ?? file[2] ?? file[3]).split(/[/\\]/).pop()
    const reused = name && !/\.(?:md|txt|json|ya?ml|toml|html|css|csv|log|patch|diff)$/i.test(name)
      && split([after, ...lines.slice(end + 1)].join('\n')).some(seg => seg.includes(name) && !NOT_RUN.test(seg))
    const substitutes = !m[1] && /\$\(|`/.test(body)
    if (/(?:^|[;&|(\s])(?:cat|tee)\b[^;&|]*$/.test(before) && !after.includes('|') && !reused && !substitutes) out.push('')
    else if (/\bpython3?\b[^;&|]*$/.test(before)) out.push(body.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, "''"))
    else out.push(body)
    out.push(lines[end])
    i = end
  }
  return out.join('\n')
}

// Split on ; && || | and newlines outside quotes.
export function split(cmd) {
  const out = []
  let cur = '', q = null
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (q) { cur += ch; if (ch === q && cmd[i - 1] !== '\\') q = null; continue }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue }
    if (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && cmd[i + 1] === '&')) {
      out.push(cur); cur = ''
      if (cmd[i + 1] === ch) i++
      continue
    }
    cur += ch
  }
  return [...out, cur].map(s => s.trim()).filter(Boolean)
}
