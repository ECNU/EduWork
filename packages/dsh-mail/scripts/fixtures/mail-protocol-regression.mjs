// Synthetic loopback servers only. Run in a child process: a parser regression
// can block its event loop, so the parent enforces the execution deadline.
import assert from 'node:assert/strict'
import net from 'node:net'
import { pathToFileURL } from 'node:url'
import { messageHandle } from '../../src/host/handles.js'
import { DEFAULTS } from '../../src/host/constants.js'

const { readMail, sendMail } = await import(pathToFileURL(process.argv[2]).href)
const sockets = new Set()
async function listen(onLine, greeting) {
  const server = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.write(greeting + '\r\n')
    let pending = ''
    socket.on('data', bytes => {
      pending += bytes.toString('utf8')
      for (let end; (end = pending.indexOf('\r\n')) >= 0;) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + 2)
        onLine(line, socket)
      }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server
}

let raw, commands = []
const imap = await listen((line, socket) => {
  commands.push(line)
  const [, tag, command] = /^(\S+) (.*)$/.exec(line) ?? []
  assert.ok(tag, 'Expected tagged IMAP command')
  const ok = () => socket.write(`${tag} OK completed\r\n`)
  if (command === 'CAPABILITY') socket.write('* CAPABILITY IMAP4rev1\r\n')
  else if (command.startsWith('LOGIN ')) { /* Synthetic credentials only. */ }
  else if (command.startsWith('LIST ')) socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n')
  else if (command.startsWith('LSUB ')) socket.write('* LSUB (\\HasNoChildren) "/" "INBOX"\r\n')
  else if (command.startsWith('EXAMINE ')) {
    socket.write('* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\n* OK [UIDNEXT 2] next\r\n')
  } else if (/^UID FETCH /i.test(command)) {
    if (command.includes('BODY.PEEK[]')) {
      socket.write(`* 1 FETCH (UID 1 BODY[] {${raw.length}}\r\n`)
      socket.write(raw)
      socket.write(')\r\n')
    } else {
      assert.ok(!command.includes('BODY['), 'A source fetch must use PEEK')
      socket.write(`* 1 FETCH (UID 1 FLAGS () RFC822.SIZE ${raw.length} INTERNALDATE "25-Oct-2026 00:00:00 +0000" BODYSTRUCTURE ("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "8BIT" 20 1))\r\n`)
    }
  } else if (command === 'LOGOUT') {
    socket.end(`* BYE goodbye\r\n${tag} OK logout\r\n`)
    return
  } else throw new Error(`Unexpected IMAP command: ${command}`)
  ok()
}, '* OK local regression fixture')

const sent = [], smtpCommands = []
let dataMode = false, data = []
const smtp = await listen((line, socket) => {
  if (dataMode) {
    if (line === '.') {
      sent.push(data.join('\r\n'))
      dataMode = false
      socket.write('250 queued locally\r\n')
    } else data.push(line)
    return
  }
  smtpCommands.push(line)
  if (line.startsWith('EHLO ')) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n')
  else if (line.startsWith('AUTH PLAIN ')) socket.write('235 authenticated\r\n')
  else if (/^(MAIL FROM:|RCPT TO:)/.test(line)) socket.write('250 OK\r\n')
  else if (line === 'DATA') {
    dataMode = true
    data = []
    socket.write('354 send message\r\n')
  } else if (line === 'QUIT') socket.end('221 goodbye\r\n')
  else throw new Error(`Unexpected SMTP command: ${line}`)
}, '220 localhost regression fixture')

// Invoke the protocol client directly with local plaintext fixtures; production
// settings validation still permits only implicit TLS or required STARTTLS.
const settings = {
  ...DEFAULTS, email: 'reader@example.org', fromName: '测试发件人',
  imapHost: '127.0.0.1', imapPort: imap.address().port, imapTls: 'fixture',
  smtpHost: '127.0.0.1', smtpPort: smtp.address().port, smtpTls: 'fixture',
}
const handle = messageHandle({ folder: 'INBOX', uidValidity: '7', uid: 1 })
const measurements = []
try {
  const cases = [
    ['normal', '收件人 <reader@example.org>'],
    // Public advisories: bounded synthetic headers, never sent externally.
    ['GHSA-v53p-9fqp-m79j', ' >' + '>[x][x]'.repeat(40_000)],
    ['GHSA-prgh-xp8r-p3m5', 'a' + '@b(c)'.repeat(130_000)],
    ['normal-after-malformed', '收件人 <reader@example.org>'],
  ]
  for (const [name, address] of cases.filter(([name]) => !process.argv[3] || name === process.argv[3])) {
    commands = []
    raw = Buffer.from([
      'From: 测试发件人 <sender@example.org>', `To: ${address}`,
      'Subject: =?UTF-8?B?5rWL6K+V6YKu5Lu2?=', 'Message-ID: <fixture@example.org>',
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit', '', '本地合成正文，不访问真实邮箱。',
    ].join('\r\n'))
    const start = performance.now()
    const result = await readMail(settings, 'fixture-only', handle)
    measurements.push({ name, bytes: raw.length, elapsedMs: Math.round(performance.now() - start) })
    assert.equal(result.subject, '测试邮件')
    assert.equal(result.from[0].address, 'sender@example.org')
    assert.equal(result.untrustedText.trim(), '本地合成正文，不访问真实邮箱。')
    if (name.startsWith('normal')) assert.equal(result.to[0].address, settings.email)
    assert.ok(commands.some(command => command.includes(' EXAMINE ')))
    assert.ok(commands.some(command => command.includes('BODY.PEEK[]')))
    assert.ok(!commands.some(command => /\b(SELECT|STORE|EXPUNGE)\b/.test(command)))
  }
  const result = await sendMail(settings, 'fixture-only', {
    to: ['recipient@example.org'], subject: '测试发送', text: 'Local synthetic message only.',
  })
  assert.equal(result.status, 'sent')
  assert.deepEqual(result.accepted, ['recipient@example.org'])
  assert.equal(sent.length, 1)
  assert.match(sent[0], /Local synthetic message only\./)
  assert.ok(smtpCommands.some(line => line.startsWith('AUTH PLAIN ')))
  console.log(JSON.stringify({ received: measurements, smtp: 'passed', readOnly: true }))
} finally {
  for (const socket of sockets) socket.destroy()
  await Promise.all([imap, smtp].map(server => new Promise(resolve => server.close(resolve))))
}
