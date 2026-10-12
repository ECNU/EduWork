import test from 'node:test'
import assert from 'node:assert/strict'
import { posix as path } from 'node:path'
import { applyHostGitIdentity as applyIdentity } from '../src/host-git-identity.mjs'

const socketRoot = '/tmp-test-root'
const uid = 1000
function applyHostGitIdentity(env, options) {
  return applyIdentity(env, { uid, launchdSshAuthSock: () => undefined, realpath: file => file, ...options })
}

function mockLstat(files) {
  return filePath => {
    const entry = files[filePath] ?? (Object.keys(files).some(file => path.dirname(file) === filePath) ? { kind: 'directory' } : undefined)
    if (!entry) {
      const error = new Error('ENOENT')
      error.code = 'ENOENT'
      throw error
    }
    return {
      uid: entry.uid ?? uid,
      isSymbolicLink() { return entry.kind === 'symlink' },
      isDirectory() { return entry.kind === 'directory' },
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
    lstat: mockLstat({ [sock]: { kind: 'socket' } }),
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
    lstat: mockLstat(files),
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
    lstat: mockLstat({ [discovered]: { kind: 'socket', mtimeMs: 1 } }),
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
    lstat: mockLstat({
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
    lstat: mockLstat({}),
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
    lstat: mockLstat({}),
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
    lstat: mockLstat({}),
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
    lstat: mockLstat({}),
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
    lstat: mockLstat({}),
  })
  assert.equal(env.PATH, '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin')
})

test('PATH with /usr/bin elsewhere is unchanged', () => {
  const original = '/opt/homebrew/bin:/usr/bin:/usr/local/bin'
  const env = { HOME: '/Users/me', PATH: original }
  applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    lstat: mockLstat({}),
  })
  assert.equal(env.PATH, original)
})

test('missing PATH is set to system dirs', () => {
  const env = { HOME: '/Users/me' }
  applyHostGitIdentity(env, {
    platform: 'darwin',
    socketRoot,
    listDir: () => [],
    lstat: mockLstat({}),
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
    lstat: mockLstat({
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
    lstat: mockLstat({
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
    lstat: mockLstat({}),
  })
  assert.equal(summary.systemGitOnPath, true)
})


test('current launchd session takes precedence over newer fallback socket', () => {
  const session = path.join(socketRoot, 'com.apple.launchd.SESSION', 'Listeners')
  const fallback = path.join(socketRoot, 'com.apple.launchd.OTHER', 'Listeners')
  const env = { SSH_AUTH_SOCK: '/gone.sock' }
  const summary = applyHostGitIdentity(env, { platform: 'darwin', socketRoot,
    launchdSshAuthSock: () => session,
    listDir: () => ['com.apple.launchd.OTHER'],
    lstat: mockLstat({ [session]: { kind: 'socket', mtimeMs: 1 }, [fallback]: { kind: 'socket', mtimeMs: 999 } }),
  })
  assert.equal(env.SSH_AUTH_SOCK, session)
  assert.equal(summary.ssh, 'launchd')
})

test('owned inherited agent remains preferred without querying launchd', () => {
  const sock = '/agent/Listeners'
  const env = { SSH_AUTH_SOCK: sock }
  const summary = applyHostGitIdentity(env, { platform: 'darwin', socketRoot,
    launchdSshAuthSock: () => { throw new Error('must not query launchd') },
    listDir: () => { throw new Error('must not scan') }, lstat: mockLstat({ [sock]: { kind: 'socket' } }),
  })
  assert.equal(env.SSH_AUTH_SOCK, sock)
  assert.equal(summary.ssh, 'inherited')
})

for (const source of ['inherited', 'launchd', 'discovered']) {
  for (const [name, overrides] of [
    ['socket owned by another user', { socket: { kind: 'socket', uid: uid + 1 } }],
    ['unresolved socket symlink', { socket: { kind: 'symlink' } }],
    ['parent owned by another user', { directory: { kind: 'directory', uid: uid + 1 } }],
    ['unresolved parent symlink', { directory: { kind: 'symlink' } }],
  ]) {
    test(`${source} rejects ${name}`, () => {
      const folder = path.join(socketRoot, 'com.apple.launchd.BAD')
      const sock = path.join(folder, 'Listeners')
      const files = {
        [folder]: overrides.directory ?? { kind: 'directory' },
        [sock]: overrides.socket ?? { kind: 'socket', mtimeMs: 100 },
      }
      const env = source === 'inherited' ? { SSH_AUTH_SOCK: sock } : {}
      const summary = applyHostGitIdentity(env, { platform: 'darwin', socketRoot,
        listDir: () => source === 'discovered' ? ['com.apple.launchd.BAD'] : [],
        launchdSshAuthSock: () => source === 'launchd' ? sock : undefined,
        lstat: mockLstat(files),
      })
      assert.equal('SSH_AUTH_SOCK' in env, false)
      assert.equal(summary.ssh, 'absent')
    })
  }
}

test('launchctl failure still permits the owned socket fallback', () => {
  const sock = path.join(socketRoot, 'com.apple.launchd.OK', 'Listeners')
  const env = {}
  const summary = applyHostGitIdentity(env, { platform: 'darwin', socketRoot,
    listDir: () => ['com.apple.launchd.OK'],
    launchdSshAuthSock: () => { throw new Error('launchctl failed') },
    lstat: mockLstat({ [sock]: { kind: 'socket', mtimeMs: 1 } }),
  })
  assert.equal(env.SSH_AUTH_SOCK, sock)
  assert.equal(summary.ssh, 'discovered')
})

test('timestamp ties have a deterministic lexical selection', () => {
  const a = path.join(socketRoot, 'com.apple.launchd.A', 'Listeners')
  const b = path.join(socketRoot, 'com.apple.launchd.B', 'Listeners')
  const files = { [a]: { kind: 'socket', mtimeMs: 10 }, [b]: { kind: 'socket', mtimeMs: 10 } }
  for (const dirs of [['com.apple.launchd.B', 'com.apple.launchd.A'], ['com.apple.launchd.A', 'com.apple.launchd.B']]) {
    const env = {}
    applyHostGitIdentity(env, { platform: 'darwin', socketRoot, listDir: () => dirs, lstat: mockLstat(files) })
    assert.equal(env.SSH_AUTH_SOCK, a)
  }
})

test('relative inherited and launchd socket paths are rejected', () => {
  const env = { SSH_AUTH_SOCK: 'agent.sock' }
  const summary = applyHostGitIdentity(env, { platform: 'darwin', socketRoot,
    launchdSshAuthSock: () => 'other.sock', listDir: () => [], lstat: () => { throw new Error('must not stat relative path') },
  })
  assert.equal('SSH_AUTH_SOCK' in env, false)
  assert.equal(summary.ssh, 'absent')
})


for (const source of ['inherited', 'launchd']) {
  for (const aliasKind of ['socket', 'parent']) {
    test(`${source} accepts an owned ${aliasKind} alias and passes the verified target`, () => {
      const alias = '/selected-agent/agent.sock'
      const target = '/real-agent/agent.sock'
      const env = source === 'inherited' ? { SSH_AUTH_SOCK: alias } : {}
      const files = {
        [alias]: { kind: aliasKind === 'socket' ? 'symlink' : 'socket' },
        ['/selected-agent']: { kind: aliasKind === 'parent' ? 'symlink' : 'directory' },
        [target]: { kind: 'socket' },
      }
      const summary = applyHostGitIdentity(env, { platform: 'darwin', socketRoot,
        listDir: () => [], launchdSshAuthSock: () => source === 'launchd' ? alias : undefined,
        lstat: mockLstat(files), realpath: file => file === alias ? target : file,
      })
      assert.equal(env.SSH_AUTH_SOCK, target)
      assert.equal(summary.ssh, source)
    })
  }
  for (const foreignPart of ['alias', 'alias parent', 'target', 'target parent']) {
    test(`${source} refuses an alias with foreign ${foreignPart} ownership`, () => {
      const alias = '/selected-agent/agent.sock'
      const target = '/real-agent/agent.sock'
      const env = source === 'inherited' ? { SSH_AUTH_SOCK: alias } : {}
      const files = {
        [alias]: { kind: 'symlink', uid: foreignPart === 'alias' ? uid + 1 : uid },
        ['/selected-agent']: { kind: 'symlink', uid: foreignPart === 'alias parent' ? uid + 1 : uid },
        [target]: { kind: 'socket', uid: foreignPart === 'target' ? uid + 1 : uid },
        ['/real-agent']: { kind: 'directory', uid: foreignPart === 'target parent' ? uid + 1 : uid },
      }
      const summary = applyHostGitIdentity(env, { platform: 'darwin', socketRoot,
        listDir: () => [], launchdSshAuthSock: () => source === 'launchd' ? alias : undefined,
        lstat: mockLstat(files), realpath: () => target,
      })
      assert.equal('SSH_AUTH_SOCK' in env, false)
      assert.equal(summary.ssh, 'absent')
    })
  }
}

test('discovery rejects even an owned alias to a valid owned socket', () => {
  const alias = path.join(socketRoot, 'com.apple.launchd.ALIAS', 'Listeners')
  const target = '/real-agent/agent.sock'
  let resolutions = 0
  const env = {}
  const summary = applyHostGitIdentity(env, { platform: 'darwin', socketRoot,
    listDir: () => ['com.apple.launchd.ALIAS'],
    lstat: mockLstat({ [alias]: { kind: 'symlink' }, [target]: { kind: 'socket' } }),
    realpath: () => { resolutions++; return target },
  })
  assert.equal('SSH_AUTH_SOCK' in env, false)
  assert.equal(summary.ssh, 'absent')
  assert.equal(resolutions, 0)
})
