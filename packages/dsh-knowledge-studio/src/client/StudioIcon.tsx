import React from 'react'

export const studioNames:Record<string,string>={report:'报告',slides:'演示文稿',table:'数据表',audio:'音频概览',video:'视频概览',mindmap:'思维导图',quiz:'测验',flashcards:'抽认卡'}
export const primaryFormats:Record<string,string>={report:'docx',slides:'pptx',table:'xlsx',audio:'wav',video:'mp4',mindmap:'png'}
export function StudioIcon({kind,size=20,tile=false}:{kind:string;size?:number;tile?:boolean}) {
  const paths:Record<string,React.ReactNode>={
    report:<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>,
    slides:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4M8 21h8M7 8h10M7 12h6"/></>,
    table:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 9v11M15 9v11"/></>,
    audio:<><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/><path d="M10 10v6M14 8v10"/></>,
    video:<><rect x="3" y="5" width="18" height="15" rx="2"/><path d="m10 10 5 3-5 3zM7 2h10"/></>,
    mindmap:<><rect x="2" y="9" width="6" height="6" rx="1"/><rect x="16" y="3" width="6" height="6" rx="1"/><rect x="16" y="15" width="6" height="6" rx="1"/><path d="M8 12h4M16 6h-4v12h4"/></>,
    quiz:<path d="M8 4H6v17h12V4h-2M9 3h6v4H9zM9 11h6m-6 5 2 2 4-4"/>,
    flashcards:<><rect x="7" y="3" width="13" height="16" rx="2"/><path d="M7 7H4v14h12v-2M11 8h5M11 12h3"/></>,
  }
  const icon=<svg data-studio-icon={kind} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>{paths[kind]||paths.report}</svg>
  return tile?<span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:size+18,height:size+18,borderRadius:10,background:'color-mix(in srgb,var(--dsw-alias-state-business-primary,#3777ba) 9%,transparent)',color:'var(--dsw-alias-state-business-primary,#3777ba)',flexShrink:0}}>{icon}</span>:icon
}
