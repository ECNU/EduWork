import {transform} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {buildVideoTemplate} from './video-template-build.mjs'

await buildVideoTemplate(fileURLToPath(new URL('../packages/artifact-services/', import.meta.url)), transform)
