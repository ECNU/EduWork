import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {WorkspaceHome} from '../../src/client/WorkspaceHome'
import {StudioArtifact} from '../../src/client/StudioArtifact'
import {ReadingFrame} from '../../src/client/ReadingFrame'
const noop=()=>{}
const artifact={id:'map',kind:'mindmap',title:'主题边界验证',status:'completed',revisionWarning:'上一版本仍可用',exports:[],citations:[],content:{nodes:[{id:'root',parentId:'',label:'交互导图',body:'界面继承全局主题；导出文件保持独立配色',evidenceIds:[]}]}}
function Fixture(){
 const [expanded,setExpanded]=useState(false)
 return <main style={{display:'grid',gridTemplateColumns:'330px 1fr',height:'95vh',fontFamily:'sans-serif'}}>
  <WorkspaceHome workspace={{title:'测试工作区',capabilities:[{id:'report',title:'报告',description:'测试卡片',available:true}],artifacts:[]}} error="测试提示" refresh={noop} invoke={noop} openArtifact={noop} close={noop}/>
  <ReadingFrame expanded={expanded} target={document.getElementById('expanded')} toggle={()=>setExpanded(!expanded)}>
   <StudioArtifact artifact={artifact} back={noop} close={noop} manage={noop} exportFile={noop} askAI={noop} showEvidence={noop} expanded={expanded} expand={()=>setExpanded(!expanded)}/>
  </ReadingFrame>
 </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
