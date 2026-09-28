import { defineConfig } from 'vitest/config'
import { aliases } from './vitest.config.ts'
export default defineConfig({resolve:{alias:aliases},test:{include:['tests/core/zz-search-perf.spec.ts']}})
