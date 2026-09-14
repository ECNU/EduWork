import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'

test('presentation pagination binds metrics and bullets, preserving oversized blocks with continuation context',()=>{
  const result=JSON.parse(execFileSync(process.env.DSH_OFFICE_PYTHON||'python',['-I','-X','utf8','-c',`
import json,sys
sys.path.insert(0,sys.argv[1])
from dsh_office.presentations.adaptive import plan
cases=[{'layout':'two-column','title':'合成双栏','left':{'heading':'左栏','bullets':['中文论述必须完整保留。'*5 for _ in range(5)]},'right':{'heading':'右栏','bullets':['对照说明不可截断。'*5 for _ in range(5)]}},
{'layout':'metrics','title':'合成指标','metrics':[{'value':str(i),'label':'完整指标名称','detail':'指标口径说明保留完整。'*3} for i in range(8)]}]
for case in cases:
 pages=plan(case); owners={}
 for pi,page in enumerate(pages):
  for ci,column in enumerate(page['columns']):
   for text,bold,repeated,block in column:
    if text and not repeated and block>=0: owners.setdefault((ci,block),set()).add(pi)
 assert len(pages)>1
 assert all(len(v)==1 for v in owners.values()),owners
 assert len(owners)==(10 if case['layout']=='two-column' else 8)
four=plan({'layout':'metrics','title':'四个指标均衡分配','metrics':[{'value':str(i),'label':'指标','detail':'说明'} for i in range(4)]})
assert len(four)==2
assert [len({block for col in page['columns'] for value,bold,repeated,block in col if value and not repeated and block>=0}) for page in four]==[2,2]
long='完整超长段落必须连续保留。'*150
pages=plan({'layout':'bullets','title':'大段续页','bullets':[long]})
lines=[value for page in pages for col in page['columns'] for value,bold,repeated,block in col if block==0 and not repeated]
assert ''.join(lines)==long
assert len(pages)>1 and any(repeated and '续' in value for page in pages for col in page['columns'] for value,bold,repeated,block in col)
assert all(sum(bool(value) and not repeated for col in page['columns'] for value,bold,repeated,block in col)>=3 for page in pages)
print(json.dumps({'passed':True,'atomicMetricAndBulletBlocks':True,'oversizePages':len(pages),'lossless':True}))
`,resolve('packages/artifact-services/python')],{encoding:'utf8',windowsHide:true}))
  assert.equal(result.passed,true)
})
