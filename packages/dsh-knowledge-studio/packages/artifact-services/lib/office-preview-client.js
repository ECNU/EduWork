// Browser-only entry point. No host imports, framework instance or conversion.
const STORE = Symbol.for('@eduwork/office-preview/view-state/v1')
const EVENT = 'eduwork-office-preview-state-v1'
const STORAGE = 'eduwork.office-preview.v1:'
const LIMIT = 80
const clamp = (value,min,max) => Math.max(min,Math.min(max,value))
const css = `
:host{display:block;height:100%;min-height:260px;color:var(--dsw-alias-label-primary,#27303b);font:12px/1.4 system-ui,sans-serif}
*{box-sizing:border-box}.viewer{height:100%;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#d8dde3);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#eef0f4)}
.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:5px;padding:8px;background:var(--dsw-alias-bg-base,#fff);border-bottom:1px solid var(--dsw-alias-border-l2,#d8dde3);flex:none}
button,select,input{font:inherit;color:inherit;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l2,#ccd2d9);border-radius:5px;height:29px;padding:3px 7px;max-width:100%}
button{cursor:pointer}button:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,#edf1f6)}button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,.viewport:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3777ba);outline-offset:-2px}
.title{width:100%;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.page-number{width:49px;text-align:center;padding:3px}.page-count{white-space:nowrap}.expand{margin-left:auto}
.viewport{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;position:relative;padding:12px}
.stage{position:relative;margin:auto;flex:none;background:white;box-shadow:0 2px 10px #1f293722}.page-frame{display:block;position:absolute;top:0;left:0;border:0;transform-origin:0 0;background:white}
.warnings{flex:none;max-height:100px;overflow:auto;padding:6px 10px;background:var(--dsw-alias-bg-layer-2,#fff7e8);color:var(--dsw-alias-state-warn-label,#765324);font-size:11px}.warnings p{margin:3px 0}.error{padding:20px;color:var(--dsw-alias-state-error-primary,#9c2635);background:var(--dsw-alias-bg-base,#fff)}
`
function savedState(win,key,count) {
  const memory=win[STORE]||(win[STORE]=new Map())
  let state=memory.get(key)
  if(!state)try{state=JSON.parse(win.sessionStorage.getItem(STORAGE+key)||'null')}catch{}
  return normalizeState(state,count)
}
function normalizeState(state,count) {
  return {page:clamp(Math.trunc(Number(state?.page)||1),1,count),mode:['fit-page','fit-width','manual'].includes(state?.mode)?state.mode:'fit-page',scale:clamp(Number(state?.scale)||1,.1,4)}
}
function saveState(win,key,state) {
  const memory=win[STORE]||(win[STORE]=new Map())
  memory.delete(key);memory.set(key,{...state})
  while(memory.size>LIMIT)memory.delete(memory.keys().next().value)
  try {
    win.sessionStorage.setItem(STORAGE+key,JSON.stringify(state))
    const keys=[]
    for(let i=0;i<win.sessionStorage.length;i++){const item=win.sessionStorage.key(i);if(item?.startsWith(STORAGE))keys.push(item)}
    while(keys.length>LIMIT){const oldest=keys.shift();if(oldest!==STORAGE+key)win.sessionStorage.removeItem(oldest)}
  }catch{}
  win.dispatchEvent(new win.CustomEvent(EVENT,{detail:{key,state:{...state}}}))
}
function readPages(doc,preview) {
  if(typeof preview?.html!=='string'||!preview.html.startsWith('<!doctype html>'))throw new Error('文件预览返回无效内容')
  const parsed=new doc.defaultView.DOMParser().parseFromString(preview.html,'text/html')
  // Enforce an independent, restrictive resource policy even for older servers.
  parsed.querySelectorAll('script,iframe,object,embed,link,base,meta[http-equiv="refresh"]').forEach(node=>node.remove())
  const policy=parsed.createElement('meta');policy.httpEquiv='Content-Security-Policy'
  policy.content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
  parsed.head.prepend(policy)
  const main=parsed.querySelector('main.slides[data-slide-width][data-slide-height]')
  if(!main)return {fixed:false,pages:['<!doctype html>'+parsed.documentElement.outerHTML],width:900,height:0}
  const width=Number(main.dataset.slideWidth),height=Number(main.dataset.slideHeight)
  const sections=[...main.querySelectorAll(':scope > section.slide-wrap')]
  const count=Number(main.dataset.slideCount)
  const declaredLimit=preview.description?.warnings?.some(warning=>warning.code==='page-limit')
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>100000||height>100000||!sections.length||!Number.isInteger(count)||sections.length>count||(sections.length<count&&!declaredLimit))throw new Error('文件预览的页面尺寸或页数不完整')
  const description=preview.description
  if(description&&(description.kind!=='slides'||description.pageCount!==count||Math.abs(description.pageWidth-width)>.01||Math.abs(description.pageHeight-height)>.01))throw new Error('预览描述与实际文件页面不一致')
  const style=parsed.createElement('style')
  // These are page *containers*. Never change the slide's text/shape rules.
  style.textContent=`html,body{margin:0!important;padding:0!important;width:${width}px!important;height:${height}px!important;min-height:0!important;overflow:hidden!important}main.slides{display:block!important;margin:0!important;padding:0!important;width:${width}px!important;height:${height}px!important}main.slides>section.slide-wrap{margin:0!important;padding:0!important;width:${width}px!important;height:${height}px!important;max-width:none!important}.slide-label,.preview-meta,[data-office-warning]{display:none!important}`
  parsed.head.append(style)
  parsed.body.replaceChildren(main)
  // Serialize only the selected page. Duplicating a large embedded-image <head>
  // for every page can multiply a 24 MB preview into gigabytes of strings.
  return {fixed:true,pages:sections,width,height,total:count,pageHTML(index){
    main.replaceChildren(sections[index])
    return '<!doctype html>'+parsed.documentElement.outerHTML
  }}
}

/** Mount the same isolated file viewer in Studio or a conversation attachment. */
export function mountOfficePreview(container,initialOptions) {
  const doc=container.ownerDocument,win=doc.defaultView
  let options={...initialOptions},source,state,key,scale=1,destroyed=false,lastPage=-1
  const host=doc.createElement('div');host.dataset.officePreviewViewer='';host.style.height='100%';container.append(host)
  const root=host.attachShadow({mode:'open'})
  const style=doc.createElement('style');style.textContent=css;root.append(style)
  const create=(tag,className,text)=>{const element=doc.createElement(tag);if(className)element.className=className;if(text)element.textContent=text;return element}
  const viewer=create('div','viewer'),toolbar=create('div','toolbar'),title=create('div','title'),viewport=create('div','viewport'),stage=create('div','stage'),warnings=create('div','warnings')
  toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','文件预览工具栏');viewport.tabIndex=0;viewport.setAttribute('aria-label','文件页面')
  root.append(viewer);viewer.append(toolbar,viewport,warnings);viewport.append(stage);toolbar.append(title)
  const button=(text,label,action)=>{const node=create('button','',text);node.type='button';node.setAttribute('aria-label',label);node.addEventListener('click',action);toolbar.append(node);return node}
  const previous=button('‹','上一页',()=>change({page:state.page-1}))
  const pageInput=create('input','page-number');pageInput.type='number';pageInput.min='1';pageInput.setAttribute('aria-label','当前页码');toolbar.append(pageInput)
  pageInput.addEventListener('change',()=>change({page:Number(pageInput.value)}))
  const count=create('span','page-count');toolbar.append(count)
  const next=button('›','下一页',()=>change({page:state.page+1}))
  const mode=create('select');mode.setAttribute('aria-label','页面缩放模式');toolbar.append(mode)
  for(const [value,label] of [['fit-page','适应页面'],['fit-width','适应宽度'],['manual','100%']]){const item=create('option','',label);item.value=value;mode.append(item)}
  mode.addEventListener('change',()=>change({mode:mode.value,scale:mode.value==='manual'?scale:state.scale}))
  const minus=button('−','缩小',()=>change({mode:'manual',scale:scale/1.2}))
  const actual=button('100%','原始尺寸 100%',()=>change({mode:'manual',scale:1}))
  const plus=button('+','放大',()=>change({mode:'manual',scale:scale*1.2}))
  const expand=button('展开阅读','展开阅读',()=>options.onExpand?.());expand.className='expand'
  const frame=create('iframe','page-frame');frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.dataset.officeFilePreview='';stage.append(frame)
  function measure() {
    if(destroyed||!source)return
    const width=Math.max(1,viewport.clientWidth-24),height=Math.max(1,viewport.clientHeight-24)
    scale=state.mode==='manual'?state.scale:!source.fixed?Math.min(1,width/source.width):state.mode==='fit-width'?width/source.width:Math.min(width/source.width,height/source.height)
    scale=clamp(scale,.01,8)
    const frameHeight=source.fixed?source.height:height/scale
    Object.assign(stage.style,{width:`${source.width*scale}px`,height:`${frameHeight*scale}px`,marginTop:`${source.fixed?Math.max(0,(height-frameHeight*scale)/2):0}px`})
    Object.assign(frame.style,{width:`${source.width}px`,height:`${frameHeight}px`,transform:`scale(${scale})`})
    mode.options[2].textContent=`${Math.round(scale*100)}%`;mode.value=state.mode
    minus.disabled=scale<=.1;plus.disabled=scale>=4
    host.dataset.officeScale=String(scale);host.dataset.officeMode=state.mode
  }
  function render() {
    title.textContent=options.title||'文件预览';frame.title=options.title||'Office 文件预览'
    expand.hidden=typeof options.onExpand!=='function'
    for(const item of [previous,pageInput,count,next])item.hidden=!source.fixed
    mode.options[0].textContent=source.fixed?'适应页面':'适应窗口'
    pageInput.value=String(state.page);pageInput.max=String(source.pages.length);count.textContent=`/ ${source.pages.length}${source.total>source.pages.length?`（文件共 ${source.total} 页）`:''}`
    previous.disabled=state.page<=1;next.disabled=state.page>=source.pages.length
    host.dataset.officePage=String(state.page);host.dataset.officeCacheKey=key;host.dataset.officeSourceHash=options.preview.description?.sourceHash||''
    if(lastPage!==state.page){frame.srcdoc=source.fixed?source.pageHTML(state.page-1):source.pages[0];lastPage=state.page;viewport.scrollTop=0;viewport.scrollLeft=0}
    warnings.replaceChildren()
    for(const warning of options.preview.description?.warnings||[]){const text=create('p','',warning.message);text.dataset.officeWarningCode=warning.code;warnings.append(text)}
    warnings.hidden=!warnings.childElementCount
    measure()
  }
  function change(patch) {
    if(!source)return
    state=normalizeState({...state,...patch},source.pages.length);render();saveState(win,key,state)
    options.onStateChange?.({...state,scale})
  }
  function load() {
    source=readPages(doc,options.preview)
    key=options.preview.description?.cacheKey
    // Legacy HTML remains readable but has no cross-file persistence identity.
    if(typeof key!=='string'||!key)key='legacy:'+Math.random().toString(36).slice(2)
    state=savedState(win,key,source.pages.length);lastPage=-1;render()
  }
  const receive=event=>{if(event.detail?.key!==key)return;state=normalizeState(event.detail.state,source.pages.length);render()}
  win.addEventListener(EVENT,receive)
  viewport.addEventListener('keydown',event=>{
    if(event.target!==viewport||!source?.fixed)return
    if(['ArrowRight','PageDown','ArrowLeft','PageUp','Home','End'].includes(event.key)){
      event.preventDefault();change({page:event.key==='Home'?1:event.key==='End'?source.pages.length:state.page+(['ArrowRight','PageDown'].includes(event.key)?1:-1)})
    }
  })
  const observer=new win.ResizeObserver(measure);observer.observe(viewport)
  function report(error){source=null;viewport.replaceChildren(create('div','error',`文件已生成，但预览无法显示。${error.message||String(error)} 请打开或下载原文件。`));viewport.firstChild.setAttribute('role','alert');toolbar.hidden=true;warnings.hidden=true;options.onError?.(error)}
  try{load()}catch(error){report(error)}
  return {
    update(nextOptions){if(destroyed)return;const old=options.preview;options={...options,...nextOptions};try{if(options.preview!==old){viewport.replaceChildren(stage);toolbar.hidden=false;load()}else if(source)render()}catch(error){report(error)}},
    getState(){return state?{...state,scale}:null},
    destroy(){if(destroyed)return;destroyed=true;observer.disconnect();win.removeEventListener(EVENT,receive);frame.removeAttribute('srcdoc');host.remove()},
  }
}
