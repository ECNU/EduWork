import test from 'node:test'
import assert from 'node:assert/strict'
import { searchAccounts } from '../src/account-search.mjs'
const rows=[{id:'a',origin:'https://example.org',username:'Teacher'},{id:'b',origin:'https://school.edu',username:'教师'}]
test('account search matches only public metadata with case-insensitive AND terms',()=>{
 assert.deepEqual(searchAccounts(rows,' EXAMPLE teacher ').map(x=>x.id),['a'])
 assert.deepEqual(searchAccounts(rows,'教师').map(x=>x.id),['b'])
 assert.equal(searchAccounts(rows,'').length,2)
 assert.equal(searchAccounts(rows,'missing').length,0)
 const sensitive={origin:'https://safe.test',username:'user',get password(){throw Error('must not read password')}}
 assert.equal(searchAccounts([sensitive],'safe').length,1)
})
test('large account lists remain searchable',()=>{
 const many=Array.from({length:10000},(_,i)=>({id:String(i),origin:`https://site${i}.test`,username:`user${i}`}))
 assert.deepEqual(searchAccounts(many,'site9999 user9999').map(x=>x.id),['9999'])
})
