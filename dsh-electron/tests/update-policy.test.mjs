import test from 'node:test'
import assert from 'node:assert/strict'
import {portableUpdateEdition,resolveUpdateConfiguration,editablePortableUpdateConfiguration} from '../src/portable-updates.mjs'

test('a publisher seed with only a release preference retains its trusted source across dev and stable',()=>{
 const trusted={provider:'static',manifestURL:'https://publisher.example/releases/stable/latest-windows-amd64.json'}
 const defaults=resolveUpdateConfiguration(trusted,{defaultPolicy:'development'})
 const dev=editablePortableUpdateConfiguration({defaults,updates:{defaultPolicy:'development'},version:'0.4.4-dev.20261016.1'})
 assert.equal(dev.provider,'static')
 assert.equal(dev.manifestURL,'https://publisher.example/releases/development/latest-windows-amd64.json')
 const stable=portableUpdateEdition({configuration:dev,version:'0.4.4'})
 assert.equal(stable.enabled,true)
 assert.equal(stable.manifestBaseURL,'https://publisher.example/releases')
 assert.equal(stable.defaultPolicy,'development')
 for(const updates of [
  {provider:'disabled'},
  {provider:'github',repository:'example/custom'},
  {provider:'static',manifestURL:'https://custom.example/releases/stable/latest-windows-amd64.json',defaultPolicy:'stable'},
 ]){
  const expected=portableUpdateEdition({configuration:updates,version:'0.4.4'})
  const actual=portableUpdateEdition({configuration:editablePortableUpdateConfiguration({defaults,updates,version:'0.4.4'}),version:'0.4.4'})
  for(const key of ['enabled','provider','repository','manifestBaseURL'])assert.equal(actual[key],expected[key],key)
 }
 const override=resolveUpdateConfiguration(trusted,{provider:'github',repository:'example/package'})
 assert.equal(override.manifestURL,undefined)
 assert.equal(portableUpdateEdition({configuration:override,version:'0.4.4'}).repository,'example/package')
})

test('writing update defaults preserves the actual source, channel, and disabled choice across restarts', () => {
 const defaults={provider:'github',repository:'example/product',defaultPolicy:'development'},version='0.3.6-dev.1'
 const cases=[
  {updates:{}},
  {updates:{},prior:{schemaVersion:1,enabled:true,manifestBaseURL:'https://institution.example.test/bridge',target:'windows-amd64'}},
  {updates:{provider:'static',manifestURL:'https://custom.example.test/stable/latest-windows-amd64.json',defaultPolicy:'stable'}},
  {updates:{provider:'disabled'}},
 ]
 for(const entry of cases){
  const actual=portableUpdateEdition({configuration:resolveUpdateConfiguration(defaults,entry.updates,entry.prior),prior:entry.prior,version})
  const written=editablePortableUpdateConfiguration({...entry,defaults,version})
  const next=portableUpdateEdition({configuration:resolveUpdateConfiguration(defaults,written,entry.prior),prior:entry.prior,version})
  for(const key of ['enabled','repository','manifestBaseURL','defaultPolicy']) assert.equal(next[key],actual[key],key)
  assert.equal(Boolean(written.provider),true)
 }
})

test('package channel is independent of feed URL and preserved old bridge config',()=>{
 const manifestURL='https://updates.example.test/releases-bridge/stable/latest-windows-amd64.json'
 assert.equal(portableUpdateEdition({configuration:{manifestURL},version:'0.3.5-dev.20260913.1'}).defaultPolicy,'development')
 for (const version of ['0.3.5-alpha.1', '0.3.5-beta.1', '0.3.5-rc.1']) {
  assert.equal(portableUpdateEdition({configuration:{manifestURL},version}).defaultPolicy,'development')
 }
 assert.equal(portableUpdateEdition({configuration:{manifestURL},version:'0.3.5'}).defaultPolicy,'stable')
 const prior={schemaVersion:1,enabled:true,manifestBaseURL:'https://updates.example.test/custom',defaultPolicy:'stable'}
 const edition=portableUpdateEdition({configuration:{defaultPolicy:'development'},version:'0.3.5-dev.20260913.1',prior})
 assert.equal(edition.manifestBaseURL,prior.manifestBaseURL)
 assert.equal(edition.defaultPolicy,'development')
 assert.equal(portableUpdateEdition({configuration:{manifestURL,defaultPolicy:'stable'},version:'0.3.5-dev.20260913.1'}).defaultPolicy,'stable')
 assert.throws(()=>portableUpdateEdition({configuration:{defaultPolicy:'nightly'},version:'0.3.5'}))
})

test('GitHub defaults respect explicit static sources, disabled updates and migrated Go feeds',()=>{
 const defaults={provider:'github',repository:'ecnu/EduWork',defaultPolicy:'stable'}
 const prior={schemaVersion:1,enabled:true,manifestBaseURL:'https://school.example/bridge',defaultPolicy:'development'}
 const version='0.3.7',make=(updates={},old=null)=>portableUpdateEdition({configuration:resolveUpdateConfiguration(defaults,updates,old),version,prior:old})
 assert.equal(make().provider,'github')
 assert.equal(make().repository,'ecnu/EduWork')
 assert.equal(make({},prior).manifestBaseURL,prior.manifestBaseURL)
 assert.equal(make({defaultPolicy:'development'},prior).manifestBaseURL,prior.manifestBaseURL)
 const manifestURL='https://school.example/releases/stable/latest-windows-amd64.json'
 assert.equal(make({manifestURL}).provider,'static')
 assert.equal(make({manifestURL}).manifestBaseURL,'https://school.example/releases')
 assert.equal(make({provider:'disabled'},prior).enabled,false)
 assert.equal(make({provider:'github',repository:'ecnu/EduWork'},prior).provider,'github')
 const switched=resolveUpdateConfiguration({provider:'static',manifestURL},{provider:'github',repository:'ecnu/EduWork'})
 assert.equal(portableUpdateEdition({configuration:switched,version}).provider,'github')
 assert.throws(()=>make({provider:'github',repository:'https://github.com/ecnu/EduWork'}))
 assert.throws(()=>make({provider:'other'}))
})
