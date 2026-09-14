import test from 'node:test'
import assert from 'node:assert/strict'
import {auditDocument,auditPackageDocuments} from '../scripts/document-policy.mjs'

function archive(files) {
  const entries=[]
  for(const [name,text] of Object.entries(files)) {
    const body=Buffer.from(text),header=Buffer.alloc(512)
    header.write('package/'+name,0,100)
    header.write(body.length.toString(8).padStart(11,'0')+'\0',124,12)
    header[156]=48
    entries.push(header,body,Buffer.alloc((512-body.length%512)%512))
  }
  return Buffer.concat([...entries,Buffer.alloc(1024)])
}

test('archive documentation resolves links within its own package',()=>{
  const text='[Guide](docs/USAGE.md) · [Release](https://github.com/example/project/blob/main/docs/RELEASING.md)'
  const packed=archive({'README.md':text,'docs/USAGE.md':'Use the generic theme.'})
  assert.deepEqual(auditPackageDocuments(packed,'fixture'),{documents:2,examples:0,links:1})
  assert.throws(()=>auditPackageDocuments(archive({'README.md':'[Release](docs/RELEASING.md)'}),'fixture'),/Missing local documentation link/)
  assert.throws(()=>auditPackageDocuments(archive({'docs/ARCHITECTURE.md':'[Shared](../packages/shared/README.md)'}),'fixture'),/Missing local documentation link/)
})

test('documentation preserves compatibility names and rejects business examples',()=>{
  const valid='Use modern-clean. Legacy ecnu-liwa requires DSH_OFFICE_BRAND_ASSETS.\n```json\n{"theme":"modern-clean","author":"Example team"}\n```'
  assert.equal(auditDocument(valid,'README.md',new Set()).examples,1)
  const domain=['service','ecnu','edu','cn'].join('.')
  assert.throws(()=>auditDocument('Contact '+domain,'README.md',new Set()),/Institution business domain/)
  assert.throws(()=>auditDocument('```json\n{"caption":"ChatECNU Work"}\n```','README.md',new Set()),/Institution-specific example/)
})

test('malformed JSON examples are rejected before packaging',()=>{
  assert.throws(()=>auditDocument('```json\n{"theme":}\n```','README.md',new Set()),SyntaxError)
})
