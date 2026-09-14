import React,{useState,useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {StudioArtifact} from '../../src/client/StudioArtifact'
function wave(){const b=new Uint8Array(1644),v=new DataView(b.buffer);const s=(i:number,t:string)=>{for(const c of t)b[i++]=c.charCodeAt(0)};s(0,'RIFF');v.setUint32(4,1636,true);s(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);s(36,'data');v.setUint32(40,1600,true);return btoa(String.fromCharCode(...b))}
function Demo(){
 const [id,setID]=useState('slow'),[ticks,setTicks]=useState(0),[calls,setCalls]=useState(0),pending=useRef<any>(null),attempts=useRef(0),delayNext=useRef(false),pendingDownload=useRef<(()=>void)|null>(null)
 const revision=['history','revised','fallback'].includes(id),kind=revision||['slow','audio','audio-captioned','audio-text','failure'].includes(id)?'audio':id
 const artifact:any={id:revision?'revision-artifact':id,kind,title:id,status:'completed',exports:[{format:({report:'docx',slides:'pptx',table:'xlsx',video:'mp4'} as Record<string,string>)[kind]||'wav',path:kind}],citations:[{evidenceId:'e1',path:'source.md',lineStart:1}],content:kind==='audio'?{segments:[{id:'s1',speaker:'A',text:'隐藏的逐字稿',evidenceIds:['e1']}]}:kind==='video'?{scenes:[{id:'s1',narration:'合成分镜旁白'}]}:kind==='mindmap'?{nodes:[{id:'n1',label:'合成导图',parentId:null}]}:kind==='quiz'?{questions:[]}:kind==='flashcards'?{cards:[]}:kind==='slides'?{slides:[{id:'s1',heading:'演示内容',bullets:['重点'],notes:'隐藏讲稿',evidenceIds:['e1']}]}:kind==='table'?{columns:['指标'],rows:[{id:'r1',cells:['完整性'],evidenceIds:['e1']}]}:{sections:[{id:'s1',heading:'报告内容',body:'正文',evidenceIds:['e1']}]}}
 artifact.exports.push({format:'json',path:'internal.json'},{format:'poster',path:'internal.jpg'})
 if(id==='video'||id==='audio-captioned')artifact.exports.push({format:'srt',path:'captions.srt'},{format:'vtt',path:'captions.vtt'})
 if(id==='audio-text')artifact.exports=[]
 if(revision){
  artifact.version=id==='history'?2:3
  artifact.exports=[{format:'wav',path:`revision/attempt-${artifact.version}/audio.wav`}]
  artifact.attempts=id==='history'?[{version:1,status:'completed',message:''}]:[{version:1,status:'completed',message:''},{version:2,status:'completed',message:''}]
  if(id==='fallback'){
   artifact.revisionWarning='最后一次修改未完成，显示第 3 版；修改记录已保留'
   artifact.attempts.push({version:4,status:'failed',message:'导出失败'},{version:6,status:'cancelled',message:'用户取消'},{version:7,status:'interrupted',message:'进程中断'},{status:'failed',message:'旧记录未保存版本号'})
  }
 }
 return <div style={{height:'100vh',display:'grid',gridTemplateColumns:'220px 390px'}}><nav>{['slow','audio','audio-captioned','audio-text','video','failure','report','slides','table','mindmap','quiz','flashcards','history','revised','fallback'].map(x=><button key={x} onClick={()=>setID(x)}>{x}</button>)}<button onClick={()=>setTicks(ticks+1)}>刷新状态</button><button onClick={()=>pending.current?.({data:wave(),fileName:'slow.wav'})}>完成旧请求</button><button onClick={()=>{delayNext.current=true}}>延迟下次下载</button><button onClick={()=>pendingDownload.current?.()}>完成旧版下载</button><output data-calls>{calls}</output><output>{ticks}</output></nav><StudioArtifact artifact={artifact} back={()=>{}} close={()=>{}} manage={()=>{}} askAI={()=>{}} showEvidence={()=>{}} exportFile={async(format:string)=>{setCalls(c=>c+1);if(id==='slow')return new Promise(r=>{pending.current=r});if(id==='video'&&format==='mp4')return new Promise(()=>{});if(id==='failure'&&attempts.current++===0)throw new Error('测试加载失败');if(format==='preview')return {html:'<!doctype html><main>'+ (kind==='table'?'<table><tr><th>指标</th></tr><tr><td>完整性</td></tr></table>':'文件中的正文')+'</main>'};const file={data:wave(),fileName:id+(revision?`-v${artifact.version}`:'')+'.'+format};if(revision&&format==='wav'&&delayNext.current){delayNext.current=false;return new Promise(resolve=>{pendingDownload.current=()=>{resolve(file);pendingDownload.current=null}})}return file}}/></div>
}
createRoot(document.getElementById('root')!).render(<Demo/> )
