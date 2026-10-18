const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const locale = window.EduWorkLocale;
const t = locale.text;
function applyTheme(theme, save = false) {
  theme = theme === 'blue' ? 'blue' : 'red';
  document.documentElement.dataset.theme = theme;
  $$('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)));
  const logo = theme === 'blue' ? './assets/eduwork-blue.svg' : './assets/eduwork.svg';
  $$('[data-theme-logo]').forEach(img => { img.src = logo; });
  $('link[rel="icon"]').href = logo;
  $('meta[name="theme-color"]').content = theme === 'blue' ? '#f7f9fd' : '#faf9f6';
  if (save) { try { localStorage.setItem('eduwork-site-theme', theme); } catch {} }
}
$$('[data-theme-choice]').forEach(button => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice, true)));
applyTheme(document.documentElement.dataset.theme);
window.addEventListener('storage', event => { if (event.key === 'eduwork-site-theme') applyTheme(event.newValue); });
let community = null;
let chartRange = 'all';
let dataFailed = false;
let copyStatus = '';
const layers = {
  dsh: 'DSH 提供 Agent 运行时与插件体系。EduWork 持续复用上游的会话、工具、浏览器与文件能力。',
  eduwork: '在同一运行基础上，维护教育场景的公共组合。通用改进回到公版，机构通过配置与插件接入。',
  institution: '通过机构配置、业务插件和场景技能形成自己的发行组合。EduWork@ECNU 是其中一个实践。'
};
$$('[data-layer]').forEach(button => button.addEventListener('click', () => {
  $$('[data-layer]').forEach(node => node.setAttribute('aria-pressed',String(node === button)));
  $('#layer-description').textContent = t(layers[button.dataset.layer]);
}));
const views = {
  workspace: {file:'workspace',title:'对话、工具与成果，在同一个工作区。',description:'复用 DSH 的 Agent 能力，围绕本机资料开展任务，预览结果并继续完善。',alt:'EduWork 公版对话工作区与网页成果预览',doc:'https://github.com/ECNU/EduWork/blob/main/docs/USER_GUIDE.md'},
  studio: {file:'studio',title:'资料驱动的成果创作，通过插件扩展。',description:'Knowledge Studio 共用对话中的创作服务，以插槽接入成果类型、预览与后续操作。',alt:'Knowledge Studio 成果管理与创作面板',doc:'https://github.com/ECNU/EduWork/tree/main/packages/dsh-knowledge-studio'},
  models: {file:'litellm-models',title:'使用组织账号，发现已获授权的模型。',description:'连接兼容的机构网关；学校模型与个人 API Key 可以同时使用，权限与配额由服务端管理。',alt:'EduWork 中连接 LiteLLM 后显示获授权的模型',doc:'https://github.com/ECNU/EduWork/blob/main/packages/dsh-oidc/docs/gateway-auth/litellm-setup.md'}
};
$$('[data-view]').forEach(button => button.addEventListener('click', () => {
  $$('[data-view]').forEach(tab => {const selected=tab===button;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
  const view=views[button.dataset.view];
  $('#showcase-panel').setAttribute('aria-labelledby',button.id);
  $('#showcase-image').src=`./assets/screenshots/${view.file}.png`;
  renderViewText(view);
}));
function renderViewText(view) {
  $('#showcase-image').alt=t(view.alt);
  $('#showcase-title').textContent=t(view.title);
  $('#showcase-description').textContent=t(view.description);
  $('#showcase-doc').href=locale.link(view.doc);
  $('#lightbox-image').alt=t(view.alt);
  $('#lightbox-caption').textContent=t(view.title);
}
$('.showcase-tabs').addEventListener('keydown',event=>{
  const tabs=$$('[data-view]');const index=tabs.indexOf(document.activeElement);if(index<0)return;
  const target={ArrowRight:(index+1)%tabs.length,ArrowLeft:(index+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
  if(target!==undefined){event.preventDefault();tabs[target].focus();tabs[target].click();}
});
$$('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  const category=button.dataset.filter;
  $$('[data-filter]').forEach(tab=>tab.setAttribute('aria-pressed',String(tab===button)));
  $$('.plugin-card').forEach(card=>card.hidden=category!=='all'&&card.dataset.category!==category);
  renderPluginCount();
}));
function renderPluginCount() {
  $('#plugin-count').textContent=t('展示 {count} 个插件 · 具体运行条件与兼容范围见各插件文档',{count:$$('.plugin-card:not([hidden])').length});
}
$('#copy-command').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText('git clone https://github.com/ECNU/EduWork.git');copyStatus='已复制克隆命令';}
  catch{copyStatus='请选中上方命令复制';}
  $('#copy-status').textContent=t(copyStatus);
});
const menu=$('.menu-toggle');const nav=$('#main-nav');
const closeMenu=()=>{menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label',t('展开导航'));nav.classList.remove('is-open');};
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',t(open?'收起导航':'展开导航'));nav.classList.toggle('is-open',open);});
$$('#main-nav a').forEach(link=>link.addEventListener('click',closeMenu));
document.addEventListener('click',event=>{if(!event.target.closest('.header-inner'))closeMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
const showDialog=dialog=>{closeMenu();dialog.showModal();document.body.classList.add('modal-open');};
$$('[data-download]').forEach(button=>button.addEventListener('click',()=>showDialog($('#download-dialog'))));
$('#showcase-zoom').addEventListener('click',()=>{
  $('#lightbox-image').src=$('#showcase-image').src;$('#lightbox-image').alt=$('#showcase-image').alt;
  $('#lightbox-caption').textContent=$('#showcase-title').textContent;showDialog($('#image-dialog'));
});
$$('dialog').forEach(dialog=>{
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>document.body.classList.remove('modal-open'));
  dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))dialog.close();});
});
const svgElement=(name,attrs={},text)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',name);Object.entries(attrs).forEach(([key,value])=>el.setAttribute(key,String(value)));if(text!==undefined)el.textContent=text;return el;};
function renderChart(){
  if(!community){$('#star-chart').textContent=t(dataFailed?'暂时无法读取趋势数据。':'正在读取项目数据…');return;}
  const original=community.history;
  if(!original.length){$('#star-chart').textContent=t('暂无历史数据');return;}
  const lastDate=Date.parse(`${original.at(-1).date}T00:00:00Z`);
  const cutoff=chartRange==='14'?lastDate-13*86400000:Date.parse(`${original[0].date}T00:00:00Z`)-86400000;
  const filtered=original.filter(point=>Date.parse(`${point.date}T00:00:00Z`)>=cutoff);
  const before=original.filter(point=>Date.parse(`${point.date}T00:00:00Z`)<cutoff).at(-1);
  const points=[{date:new Date(cutoff).toISOString().slice(0,10),stars:before?.stars||0},...filtered];
  const W=510,H=205,left=37,right=12,top=15,bottom=30;
  const max=Math.ceil(Math.max(community.stars,...points.map(p=>p.stars))/40)*40||40;
  const x=date=>left+(Date.parse(`${date}T00:00:00Z`)-cutoff)/Math.max(86400000,lastDate-cutoff)*(W-left-right);
  const y=count=>H-bottom-count/max*(H-top-bottom);
  const svg=svgElement('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':t('Star 累计趋势：{start} 至 {end}，当前 {count} 个 Star。',{start:points[0].date,end:points.at(-1).date,count:community.stars})});
  for(let count=0;count<=max;count+=max/4){svg.append(svgElement('line',{x1:left,y1:y(count),x2:W-right,y2:y(count),stroke:'var(--line)','stroke-dasharray':'3 4'}),svgElement('text',{x:left-10,y:y(count)+3,'text-anchor':'end'},count));}
  const line=points.map((point,index)=>`${index?'L':'M'} ${x(point.date).toFixed(2)} ${y(point.stars).toFixed(2)}`).join(' ');
  svg.append(svgElement('path',{d:`${line} L ${x(points.at(-1).date)} ${H-bottom} L ${left} ${H-bottom} Z`,fill:'var(--chart-fill)',stroke:'none'}));
  svg.append(svgElement('path',{d:line,fill:'none',stroke:'var(--accent)','stroke-width':2.5}));
  [points[0],points[Math.floor(points.length/2)],points.at(-1)].forEach((point,index)=>svg.append(svgElement('text',{x:x(point.date),y:H-5,'text-anchor':index===0?'start':index===2?'end':'middle'},point.date.slice(5).replace('-','/'))));
  points.slice(1).forEach(point=>{const circle=svgElement('circle',{cx:x(point.date),cy:y(point.stars),r:2.8,class:'chart-point',tabindex:0,'aria-label':`${point.date}：${point.stars} Stars`});circle.append(svgElement('title',{},`${point.date} · ${point.stars} Stars`));svg.append(circle);});
  $('#star-chart').replaceChildren(svg);
}
$$('[data-range]').forEach(button=>button.addEventListener('click',()=>{chartRange=button.dataset.range;$$('[data-range]').forEach(tab=>tab.setAttribute('aria-pressed',String(tab===button)));renderChart();}));
fetch('./assets/data/community.json').then(response=>{if(!response.ok)throw new Error('Data unavailable');return response.json();}).then(data=>{
  community=data;
  const values={stars:data.stars,release:data.release.tag};
  $$('[data-stat]').forEach(element=>element.textContent=values[element.dataset.stat]);
  renderDataDate();
  renderChart();
  for(const asset of data.release.assets){const type=asset.name.endsWith('setup.zip')?'windows':asset.name.endsWith('.dmg')?'mac':null;if(type){$(`#download-${type}`).href=asset.url;$(`#${type}-size`).textContent=`${(asset.size/1024/1024).toFixed(1)} MiB · ${data.release.tag}`;}}
}).catch(()=>{
  dataFailed=true;
  renderDataDate();
  renderChart();
});
function renderDataDate() {
  if(!community){$('#data-date').textContent=t(dataFailed?'数据暂不可用，请查看 GitHub':'GitHub 公开数据');return;}
  const date=new Intl.DateTimeFormat(locale.language==='en'?'en-US':'zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'short',day:'numeric'}).format(new Date(community.fetchedAt));
  $('#data-date').textContent=t('GitHub 数据 · {date}',{date});
}
function renderLanguage() {
  $('#layer-description').textContent=t(layers[$('[data-layer][aria-pressed="true"]').dataset.layer]);
  renderViewText(views[$('[data-view][aria-selected="true"]').dataset.view]);
  renderPluginCount();
  $('#copy-status').textContent=t(copyStatus);
  menu.setAttribute('aria-label',t(menu.getAttribute('aria-expanded')==='true'?'收起导航':'展开导航'));
  if(!community){
    $('#download-title [data-stat]').textContent=t('稳定版');
    $('#windows-size').textContent=t('查看最新 Release');
    $('#mac-size').textContent=t('查看最新 Release');
  }
  renderDataDate();
  renderChart();
}
window.addEventListener('eduwork-language-change',renderLanguage);
renderLanguage();
