import assert from 'node:assert/strict'
import {posix} from 'node:path'

export function auditDocument(markdown, file, files) {
  // Compatibility identifiers and upstream copyright notices remain valid.
  assert.ok(!/(?:[a-z\d-]+\.)*ecnu\.edu\.cn\b/i.test(markdown), 'Institution business domain in public documentation: '+file)
  let examples=0
  for(const [,code] of markdown.matchAll(/```json\s*\r?\n([\s\S]*?)```/g)) {
    JSON.parse(code)
    assert.ok(!/ChatECNU Work|华东师范大学|信息化治理办公室/.test(code), 'Institution-specific example in public documentation: '+file)
    examples++
  }
  // Check local links in the relevant distribution, not just the source tree.
  const prose=markdown.replace(/```[^\n]*\n[\s\S]*?```/g,'')
  let links=0
  for(const [,href] of prose.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    if(/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href))continue
    const target=posix.normalize(posix.join(posix.dirname(file),decodeURIComponent(href.split(/[?#]/)[0])))
    assert.ok(!target.startsWith('../')&&files.has(target), 'Missing local documentation link: '+file+' -> '+target)
    links++
  }
  return {examples,links}
}

// Inspect actual npm archive entries without extracting them to the filesystem.
export function auditPackageDocuments(tar, label) {
  const entries=new Map()
  for(let offset=0;offset+512<=tar.length;) {
    const header=tar.subarray(offset,offset+512)
    if(header.every(byte=>byte===0))break
    const field=(start,length)=>header.subarray(start,start+length).toString('utf8').split('\0')[0]
    const sizeText=field(124,12).trim()
    assert.match(sizeText,/^[0-7]+$/, 'Invalid archive size: '+label)
    const size=parseInt(sizeText,8),start=offset+512
    assert.ok(Number.isSafeInteger(size)&&start+size<=tar.length, 'Truncated archive: '+label)
    const prefix=field(345,155),name=(prefix?prefix+'/':'')+field(0,100)
    if(header[156]===0||header[156]===48)entries.set(name.replace(/^package\//,''),tar.subarray(start,start+size))
    offset=start+Math.ceil(size/512)*512
  }
  const files=new Set(entries.keys()),result={documents:0,examples:0,links:0}
  for(const [file,bytes] of entries) {
    if(!file.endsWith('.md'))continue
    const checked=auditDocument(bytes.toString('utf8'),file,files)
    result.documents++;result.examples+=checked.examples;result.links+=checked.links
  }
  return result
}
