import {readFile} from 'node:fs/promises'

/** Pure design references shared with the Office skill. No workflow/approval
 * instructions, user paths, runtime provisioning, credentials or network IO. */
export async function readPresentationDesign({signal}={}) {
  const references=['presentation-spec.md','profile-library.md']
  const documents=await Promise.all(references.map(async name=>{
    const markdown=await readFile(new URL('../skills/presentations/references/'+name,import.meta.url),{encoding:'utf8',signal})
    if(Buffer.byteLength(markdown)>128*1024)throw new Error('Shared presentation design reference is unexpectedly large')
    return {source:'artifact-presentations/references/'+name,markdown}
  }))
  return documents
}
