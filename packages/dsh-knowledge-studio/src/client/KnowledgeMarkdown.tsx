import React from 'react'
import ReactMarkdown,{defaultUrlTransform} from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Safe Markdown for the source snapshot opened from an artifact citation. */
export function KnowledgeMarkdown({page}:any) {
  const content=String(page?.content??'')
  return <div className="ks-knowledge-markdown">
    <style>{`
      .ks-knowledge-markdown{min-width:0;overflow-wrap:anywhere;line-height:1.75}
      .ks-knowledge-markdown h1{margin:0 0 16px;font-size:23px;line-height:1.4}
      .ks-knowledge-markdown h2{margin:24px 0 9px;font-size:18px;line-height:1.45}
      .ks-knowledge-markdown h3{margin:18px 0 7px;font-size:15px;line-height:1.5}
      .ks-knowledge-markdown p{margin:8px 0}.ks-knowledge-markdown ul,.ks-knowledge-markdown ol{padding-left:24px}
      .ks-knowledge-markdown a{color:var(--dsw-alias-state-business-primary,#963442);text-underline-offset:3px}
      .ks-knowledge-markdown pre{max-width:100%;overflow:auto;white-space:pre;padding:12px 14px;border-radius:7px;background:var(--dsw-alias-bg-layer-2,#f7f3f1);font-size:12px;line-height:1.65}
      .ks-knowledge-markdown code{font-family:ui-monospace,Consolas,monospace}.ks-knowledge-markdown :not(pre)>code{background:var(--dsw-alias-bg-layer-2,#f7f3f1);padding:1px 4px;border-radius:4px}
      .ks-knowledge-markdown blockquote{margin:16px 0;padding:2px 14px;border-left:3px solid var(--dsw-alias-border-l2,#e3d9d4);color:var(--dsw-alias-label-secondary,#746965)}
      .ks-knowledge-markdown table{width:100%;border-collapse:collapse;font-size:13px}.ks-knowledge-markdown th,.ks-knowledge-markdown td{border:1px solid var(--dsw-alias-border-l2,#e3d9d4);padding:7px;text-align:left}
      .ks-knowledge-markdown th{background:var(--dsw-alias-bg-layer-2,#f7f3f1)}.ks-markdown-image{font-size:12px;color:var(--dsw-alias-label-secondary,#746965)}
    `}</style>
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
      urlTransform={defaultUrlTransform}
      components={{
        a:({href='',children,node:_node,...props})=>{
          return href?<a href={href} {...props}>{children}</a>:<span>{children}</span>
        },
        img:({alt})=>alt?<span className="ks-markdown-image">[图片：{alt}]</span>:null,
        table:({children})=><div style={{overflowX:'auto'}}><table>{children}</table></div>,
      }}>{content}</ReactMarkdown>
  </div>
}
