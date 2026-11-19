// Plain ESM: copy the modules; the Host provides schemastery and the decision client comes from npm.
import { copyFile, mkdir } from 'node:fs/promises'
await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
for (const file of ['index.js', 'review.js', 'rules.js', 'questions.js']) await copyFile(new URL('../src/' + file, import.meta.url), new URL('../lib/' + file, import.meta.url))
