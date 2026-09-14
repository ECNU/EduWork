import {randomUUID} from 'node:crypto'
import {mkdir,realpath} from 'node:fs/promises'
import {join,relative,isAbsolute} from 'node:path'

export function assertWithinWorkspace(root,target) {
  const rel=relative(root,target)
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw new Error('Media output outside workspace')
  return rel
}

export async function createMediaJobDirectory(root) {
  root=await realpath(root)
  let directory=root
  // Resolve each existing parent before creating its child. An external .artifacts
  // junction must be rejected before any media job is written through it.
  for(const name of ['.artifacts','media',randomUUID()]) {
    const next=join(directory,name)
    try {await mkdir(next)} catch(error) {if(error.code!=='EEXIST')throw error}
    directory=await realpath(next)
    assertWithinWorkspace(root,directory)
  }
  return directory
}
