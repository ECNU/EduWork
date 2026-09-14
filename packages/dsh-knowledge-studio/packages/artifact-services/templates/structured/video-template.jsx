import React from 'react'
import { AbsoluteFill, Audio, Composition, Sequence, registerRoot, useCurrentFrame, useVideoConfig, interpolate } from 'remotion'

const Scene = ({scene,index,total,subtitles}) => {
  const frame = useCurrentFrame()
  const {width,height}=useVideoConfig(),vertical=height>width
  return <AbsoluteFill style={{background:'#f6f4ef',color:'#20313e',padding:vertical?'100px 70px':'55px 85px',fontFamily:'Microsoft YaHei, sans-serif',opacity:interpolate(frame,[0,10],[0,1],{extrapolateRight:'clamp'})}}>
    <div style={{fontSize:26,color:'#913943',marginBottom:45}}>KNOWLEDGE STUDIO　/　{index+1} · {total}</div>
    <h1 style={{fontSize:vertical?52:56,lineHeight:1.35,margin:0,maxWidth:1080}}>{scene.heading}</h1>
    <div style={{marginTop:35,fontSize:32,lineHeight:1.5,flex:1}}>{scene.bullets.slice(0,3).map((bullet,i)=><div key={i} style={{marginBottom:18}}>{bullet}</div>)}</div>
    <div style={{minHeight:96,fontSize:vertical?30:32,lineHeight:1.45,background:'#20313e',color:'white',padding:'14px 22px',borderRadius:10,visibility:subtitles&&scene.audio&&frame>=scene.fromFrame&&frame<scene.fromFrame+scene.audioFrames?'visible':'hidden'}}>{scene.text}</div>
    {scene.audio&&<Sequence from={scene.fromFrame} durationInFrames={scene.audioFrames}><Audio src={scene.audio} /></Sequence>}
  </AbsoluteFill>
}
const Video = ({scenes,subtitles,bgm}) => <AbsoluteFill>{scenes.map((scene,index)=><Sequence key={index} from={scene.startFrame} durationInFrames={scene.frames}><Scene scene={scene} index={index} total={scenes.length} subtitles={subtitles}/></Sequence>)}{bgm&&<Audio src={bgm.audio} loop loopVolumeCurveBehavior="extend" volume={frame=>scenes.some(s=>s.audio&&frame>=s.startFrame+s.fromFrame&&frame<s.startFrame+s.fromFrame+s.audioFrames)?bgm.duckVolume:bgm.volume}/>}</AbsoluteFill>
const Root = () => <Composition id="StudioVideo" component={Video} width={1280} height={720} fps={30} durationInFrames={30} defaultProps={{scenes:[],fps:30,aspect:'16:9'}} calculateMetadata={({props})=>({fps:props.fps,width:props.aspect==='9:16'?720:1280,height:props.aspect==='16:9'?720:1280,durationInFrames:Math.max(30,props.scenes.reduce((sum,s)=>sum+s.frames,0))})}/>
registerRoot(Root)
