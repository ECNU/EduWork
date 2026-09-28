import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
export const aliases = Object.fromEntries(Object.entries({
  "@eduwork/dsh-literature/core/invariant": "./src/core/invariant.ts",
  "@eduwork/dsh-literature/dblp/invariant": "./src/dblp/invariant.ts",
  "@eduwork/dsh-literature/arxiv/invariant": "./src/arxiv/invariant.ts",
  "@eduwork/dsh-literature/tool/invariant": "./src/tool/invariant.ts",
  "@eduwork/dsh-literature/core": "./src/core/index.ts",
  "@eduwork/dsh-literature/dblp": "./src/dblp/index.ts",
  "@eduwork/dsh-literature/arxiv": "./src/arxiv/index.ts",
  "@eduwork/dsh-literature/tool": "./src/tool/index.ts"
}).map(([name, path]) => [name, fileURLToPath(new URL(path, import.meta.url))]))
export default defineConfig({resolve:{alias:aliases},test:{include:['tests/**/*.spec.ts'],exclude:['tests/core/zz-search-perf.spec.ts']}})
