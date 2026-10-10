import assert from 'node:assert/strict'
import test from 'node:test'

import { LiveConnections, OPEN_REFUSED } from '../src/connections.js'

/** A stand-in for a WebSocket or stream controller. */
function fakeConnection() {
  const state = { closed: 0, throwOnClose: false }
  return {
    state,
    close() {
      if (state.throwOnClose) throw new Error('socket already gone')
      state.closed += 1
    },
  }
}

test('a connection can be opened and closed', () => {
  const live = new LiveConnections()
  const connection = fakeConnection()
  const handle = live.open('dev-1', connection)
  assert.equal(live.count('dev-1'), 1)
  assert.equal(live.total(), 1)
  assert.equal(handle.close(), true)
  assert.equal(connection.state.closed, 1)
  assert.equal(live.count('dev-1'), 0)
  assert.equal(live.total(), 0)
})

test('closing twice closes the underlying connection once', () => {
  const live = new LiveConnections()
  const connection = fakeConnection()
  const handle = live.open('dev-1', connection)
  handle.close()
  assert.equal(handle.close(), false)
  assert.equal(connection.state.closed, 1)
})

test('revocation closes every established connection for that device', () => {
  // The acceptance item: refusing later requests is not enough, because an
  // established stream keeps delivering events until it is closed.
  const live = new LiveConnections()
  const first = fakeConnection()
  const second = fakeConnection()
  const third = fakeConnection()
  live.open('dev-1', first)
  live.open('dev-1', second)
  live.open('dev-2', third)

  assert.equal(live.closeAll('dev-1'), 2)
  assert.equal(first.state.closed, 1)
  assert.equal(second.state.closed, 1)
  assert.equal(third.state.closed, 0, 'another device must not be affected')
  assert.equal(live.count('dev-1'), 0)
  assert.equal(live.count('dev-2'), 1)
})

test('a device is sealed by revocation and cannot reconnect', () => {
  // Otherwise revocation is advisory: a client that was mid-handshake when the
  // operator pressed revoke would simply carry on.
  const live = new LiveConnections()
  live.open('dev-1', fakeConnection())
  live.closeAll('dev-1')
  assert.equal(live.isSealed('dev-1'), true)
  assert.throws(() => live.open('dev-1', fakeConnection()), (error) => error.code === OPEN_REFUSED)
  assert.equal(live.count('dev-1'), 0)
})

test('a sealed device stays sealed after a second sweep', () => {
  const live = new LiveConnections()
  live.closeAll('dev-1')
  assert.equal(live.closeAll('dev-1'), 0)
  assert.equal(live.isSealed('dev-1'), true)
  assert.throws(() => live.open('dev-1', fakeConnection()), (error) => error.code === OPEN_REFUSED)
})

test('revoking a device with no connections still seals it', () => {
  const live = new LiveConnections()
  assert.equal(live.closeAll('dev-1'), 0)
  assert.equal(live.isSealed('dev-1'), true)
})

test('a connection that throws while closing does not stop the sweep', () => {
  const live = new LiveConnections()
  const broken = fakeConnection()
  broken.state.throwOnClose = true
  const healthy = fakeConnection()
  live.open('dev-1', broken)
  live.open('dev-1', healthy)
  assert.equal(live.closeAll('dev-1'), 2)
  assert.equal(healthy.state.closed, 1, 'the healthy connection must still be closed')
  assert.equal(live.count('dev-1'), 0)
})

test('a handle closed after revocation is a no-op', () => {
  const live = new LiveConnections()
  const connection = fakeConnection()
  const handle = live.open('dev-1', connection)
  live.closeAll('dev-1')
  assert.equal(handle.close(), false)
  assert.equal(connection.state.closed, 1)
})

test('devices lists only those holding connections', () => {
  const live = new LiveConnections()
  live.open('dev-b', fakeConnection())
  live.open('dev-a', fakeConnection())
  live.open('dev-a', fakeConnection())
  assert.deepEqual(live.devices(), ['dev-a', 'dev-b'])
  assert.equal(live.count('dev-a'), 2)
})

test('closeAllDevices closes everything', () => {
  const live = new LiveConnections()
  const first = fakeConnection()
  const second = fakeConnection()
  live.open('dev-a', first)
  live.open('dev-b', second)
  assert.equal(live.closeAllDevices(), 2)
  assert.equal(live.total(), 0)
})

test('an invalid device id is refused', () => {
  const live = new LiveConnections()
  assert.throws(() => live.open('', fakeConnection()), /deviceId/)
  assert.throws(() => live.open('   ', fakeConnection()), /deviceId/)
  assert.throws(() => live.closeAll(''), /deviceId/)
})

test('a connection without close() is refused', () => {
  const live = new LiveConnections()
  assert.throws(() => live.open('dev-1', {}), /close\(\) method/)
  assert.throws(() => live.open('dev-1', null), /close\(\) method/)
  assert.throws(() => live.open('dev-1', 'socket'), /close\(\) method/)
})

test('counts are zero for an unknown device', () => {
  const live = new LiveConnections()
  assert.equal(live.count('nobody'), 0)
  assert.equal(live.isSealed('nobody'), false)
  assert.deepEqual(live.devices(), [])
})
