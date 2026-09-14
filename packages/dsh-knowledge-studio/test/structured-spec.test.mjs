import test from 'node:test'
import assert from 'node:assert/strict'
import {structuredSpec} from '../packages/artifact-services/lib/structured-spec.js'
import {normalizeOfficeRequest} from '../packages/artifact-services/lib/office.js'
test('direct Office specs and legacy strings preserve literal escapes and Unicode identically',()=>{
 const spec={blocks:[{type:'paragraph',text:'中文 C:\\new\\test.txt; literal \\n and actual\nnewline; "quote"'}]}
 const args={action:'create',output_path:'test.docx'}
 const direct=normalizeOfficeRequest('document',{...args,spec})
 const legacy=normalizeOfficeRequest('document',{...args,spec_json:JSON.stringify(spec)})
 assert.deepEqual(direct,legacy)
 assert.deepEqual(JSON.parse(direct.specJSON),spec)
})
test('ambiguous, double-encoded, malformed and oversized specs fail without guessing escapes',()=>{
 assert.throws(()=>structuredSpec({spec:{},spec_json:'{}'}),/not both/)
 assert.throws(()=>structuredSpec({spec_json:JSON.stringify(JSON.stringify({text:'hello'}))}),/twice/)
 assert.throws(()=>structuredSpec({spec_json:'{\\"text\\":\\"hello\\"}'}),/pass spec as an object/)
 for(const spec of [null,[],false,'{}'])assert.throws(()=>structuredSpec({spec}),/one JSON object/)
 assert.throws(()=>structuredSpec({spec:{text:'1234567890'}},8),/too long/)
 assert.throws(()=>structuredSpec({spec_json:' '.repeat(100)},8),/too long/)
})
