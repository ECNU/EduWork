import {readFile} from 'node:fs/promises'
import {readPresentationDesign} from './office-design.js'

const references={report:['documents'],table:['spreadsheets'],slides:['presentations'],audio:['media'],video:['media']}
/** The same packaged references are read by conversation skills and Studio.
 * Keep tool workflow and output-schema adaptation at the caller boundary. */
export async function readCreationGuidance(kind,{signal}={}) {
  if(!Object.hasOwn(references,kind))return []
  const documents=await Promise.all(['common',...references[kind]].map(async name=>{
    const source=`skills/shared/references/${name}.md`
    const markdown=await readFile(new URL('../'+source,import.meta.url),{encoding:'utf8',signal})
    if(Buffer.byteLength(markdown)>128*1024)throw new Error('Shared creation reference is unexpectedly large')
    return {source,markdown}
  }))
  return kind==='slides'?[...documents,...await readPresentationDesign({signal})]:documents
}
