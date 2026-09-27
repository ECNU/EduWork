import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { applyHostGitIdentity } from '../src/host-git-identity.mjs'

const socketRoot = '/tmp-test-root'

function mockStat(files) {
  return filePath => {
    const entry = files[filePath]
    if (!entry) {
      const error = new Error('ENOENT')
      error.code = 'ENOENT'
      throw error
    }
    return {
      isSocket() {
        return entry.kind === 'socket'
      },
      mtimeMs: entry.mtimeMs ?? 0,
    }
  }
}

function mockListDir(dirs) {
  return root => {
    if (root !== socketRoot) throw new Error('unexpected root')
    return dirs
  }
}

test('existing valid socket is inherited', () => {
  const sock = '/valid/agent.sock'
  const env = { SSH_AUTH_SOCK: sock, HOME: '/Users/me', PATH: '/usr/bin' }
  const summary = applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    stat: mockStat({ [sock]: { kind: 'socket' } }),
  })
  assert.equal(env.SSH_AUTH_SOCK, sock)
  assert.equal(summary.ssh, 'inherited')
})

test('discovers newest launchd Listeners socket', () => {
  const older = path.join(socketRoot, 'com.apple.launchd.AAA', 'Listeners')
  const newer = path.join(socketRoot, 'com.apple.launchd.BBB', 'Listeners')
  const env = { HOME: '/Users/me' }
  const files = {
    [older]: { kind: 'socket', mtimeMs: 100 },
    [newer]: { kind: 'socket', mtimeMs: 200 },
  }
  const summary = applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: mockListDir(['com.apple.launchd.AAA', 'com.apple.launchd.BBB']),
    stat: mockStat(files),
  })
  assert.equal(env.SSH_AUTH_SOCK, newer)
  assert.equal(summary.ssh, 'discovered')
})

test('stale SSH_AUTH_SOCK is replaced by discovered socket', () => {
  const discovered = path.join(socketRoot, 'com.apple.launchd.ZZZ', 'Listeners')
  const env = { SSH_AUTH_SOCK: '/gone.sock', HOME: '/Users/me' }
  const summary = applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: mockListDir(['com.apple.launchd.ZZZ']),
    stat: mockStat({ [discovered]: { kind: 'socket', mtimeMs: 1 } }),
  })
  assert.equal(env.SSH_AUTH_SOCK, discovered)
  assert.equal(summary.ssh, 'discovered')
})

test('non-socket stale path is replaced', () => {
  const bad = '/not-a-socket'
  const discovered = path.join(socketRoot, 'com.apple.launchd.ONE', 'Listeners')
  const env = { SSH_AUTH_SOCK: bad }
  applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: mockListDir(['com.apple.launchd.ONE']),
    stat: mockStat({
      [bad]: { kind: 'file' },
      [discovered]: { kind: 'socket', mtimeMs: 1 },
    }),
  })
  assert.equal(env.SSH_AUTH_SOCK, discovered)
})

test('absent leaves SSH_AUTH_SOCK unset when never set', () => {
  const env = { HOME: '/Users/me' }
  const summary = applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    stat: mockStat({}),
  })
  assert.equal('SSH_AUTH_SOCK' in env, false)
  assert.equal(summary.ssh, 'absent')
})

test('absent removes stale SSH_AUTH_SOCK', () => {
  const env = { SSH_AUTH_SOCK: '/missing.sock', HOME: '/Users/me' }
  const summary = applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    stat: mockStat({}),
  })
  assert.equal('SSH_AUTH_SOCK' in env, false)
  assert.equal(summary.ssh, 'absent')
})

test('empty HOME is filled', () => {
  const env = { HOME: '', PATH: '/usr/bin' }
  const summary = applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    stat: mockStat({}),
    homedir: () => '/Users/filled',
  })
  assert.equal(env.HOME, '/Users/filled')
  assert.equal(summary.home, 'filled')
})

test('existing HOME is kept', () => {
  const env = { HOME: '/Users/kept', PATH: '/usr/bin' }
  const summary = applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    stat: mockStat({}),
    homedir: () => '/Users/other',
  })
  assert.equal(env.HOME, '/Users/kept')
  assert.equal(summary.home, 'kept')
})

test('PATH without discrete /usr/bin appends system dirs', () => {
  const env = { HOME: '/Users/me', PATH: '/opt/homebrew/bin' }
  applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    stat: mockStat({}),
  })
  assert.equal(env.PATH, '/opt/homebrew/bin' + path.delimiter + '/usr/bin:/bin:/usr/sbin:/sbin')
})

test('PATH with /usr/bin elsewhere is unchanged', () => {
  const original = '/opt/homebrew/bin:/usr/bin:/usr/local/bin'
  const env = { HOME: '/Users/me', PATH: original }
  applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    stat: mockStat({}),
  })
  assert.equal(env.PATH, original)
})

test('missing PATH is set to system dirs', () => {
  const env = { HOME: '/Users/me' }
  applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    stat: mockStat({}),
  })
  assert.equal(env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin')
})

test('non-darwin does not change env', () => {
  const env = { PATH: '/only/local', HOME: '' }
  const summary = applyHostGitIdentity(env, { platform: 'linux' })
  assert.equal(env.PATH, '/only/local')
  assert.equal(env.HOME, '')
  assert.equal(summary.ssh, 'skipped')
})

test('discovery ignores non-matching dirs and non-socket Listeners', () => {
  const fileListener = path.join(socketRoot, 'com.apple.launchd.GOOD', 'Listeners')
  const env = {}
  applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: mockListDir(['not-launchd', 'com.apple.launchd.BAD', 'com.apple.launchd.GOOD']),
    stat: mockStat({
      [fileListener]: { kind: 'file', mtimeMs: 99 },
    }),
  })
  assert.equal('SSH_AUTH_SOCK' in env, false)

  const socketListener = path.join(socketRoot, 'com.apple.launchd.OK', 'Listeners')
  const env2 = {}
  applyHostGitIdentity(env2, {
    platform: 'darwin',
    socketRoot,
    listDir: mockListDir(['com.apple.launchd.BAD-extra!', 'com.apple.launchd.OK']),
    stat: mockStat({
      [path.join(socketRoot, 'com.apple.launchd.BAD', 'Listeners')]: { kind: 'socket', mtimeMs: 1 },
      [socketListener]: { kind: 'socket', mtimeMs: 2 },
    }),
  })
  assert.equal(env2.SSH_AUTH_SOCK, socketListener)
})

test('systemGitOnPath reflects final PATH', () => {
  const env = { HOME: '/Users/me', PATH: '/opt/bin' }
  const summary = applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    stat: mockStat({}),
  })
  assert.equal(summary.systemGitOnPath, true)
})
