import { describe, expect, it } from 'vitest'

// Regression tests for the osqp tool-layer JSON shape handling (E2E-found bugs):
// upstream check_osqp_environment.py --json returns packages as an OBJECT keyed
// by name; solve_qp.py returns status as an object with classification/reported.

describe('osqp upstream JSON shape contract', () => {
  it('documents the packages-as-object shape the check tool must map', () => {
    // Reproduced from check_osqp_environment.py --json on a real machine.
    const upstream = {
      install_hint: "python3 -m pip install 'osqp>=1,<2'",
      packages: {
        numpy: { available: true, version: '2.5.4' },
        osqp: { available: true, compatible: true, version: '1.1.3' },
        scipy: { available: false, error: 'module not found' },
      },
      ready: false,
    }
    // The tool maps Object.entries into the canonical array.
    const mapped = Object.entries(upstream.packages).map(([name, info]) => {
      const detail = (typeof info === 'object' && info !== null ? info : {}) as { available?: boolean, version?: string }
      return { name, available: detail.available === true, ...(detail.version !== undefined ? { version: detail.version } : {}) }
    })
    expect(mapped).toEqual([
      { name: 'numpy', available: true, version: '2.5.4' },
      { name: 'osqp', available: true, version: '1.1.3' },
      { name: 'scipy', available: false },
    ])
    expect(upstream.ready).toBe(false)
  })

  it('documents the solve status object with classification first', () => {
    const upstreamStatus = {
      accept_inaccurate_requested: false,
      accepted: true,
      classification: 'solved',
      inaccurate: false,
      reported: 'solved',
      value: 1,
    }
    const canonical = upstreamStatus.classification ?? upstreamStatus.reported ?? 'unknown'
    expect(canonical).toBe('solved')
  })
})
