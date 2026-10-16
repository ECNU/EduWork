// Load the panel bundle in a CommonJS scope whose requires resolve from the
// pinned runtime.
//
// The bundle esbuild produced is CommonJS and `require`s `react`, which lives in
// the runtime's `node_modules` rather than next to the bundle. Requiring it with
// a scope anchored at the runtime gives the bundle the shell's own React — the
// same copy this test's assertions inspect — instead of a second one.
import { createRequire, Module } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param path - the CommonJS bundle to evaluate.
 * @param runtime - the pinned runtime directory holding `node_modules`.
 * @returns the bundle's exports.
 */
export function loadBundle(path, runtime) {
  const runtimeRequire = createRequire(join(runtime, 'package.json'))
  const previous = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === path && request !== 'node:module') {
      try {
        return runtimeRequire(request)
      } catch (error) {
        if (error?.code !== 'MODULE_NOT_FOUND') throw error
      }
    }
    return previous.apply(this, arguments)
  }
  try {
    const Module_ = Module
    const module_ = new Module_(path, null)
    module_.filename = path
    module_.paths = Module_._nodeModulePaths(join(runtime, 'node_modules'))
    module_._compile(readFileSync(path, 'utf8'), path)
    return module_.exports
  } finally {
    Module._load = previous
  }
}
