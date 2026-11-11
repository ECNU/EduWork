import React, { useEffect, useState } from 'react'
import { Button, Switch, Input, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { settingsStyle } from './settings-style.mjs'
import { searchAccounts } from './account-search.mjs'
export const inject = ['slots', 'locale']
const NS = 'eduwork-password-manager'
const h = React.createElement
const zh={title:'密码管理器',loading:'正在加载…','not-supported':'当前桌面尚未启用内建密码库。','operation-failed':'操作未完成，请重试。','vault-unavailable':'系统密码库暂不可用。','user-action-required':'请点击按钮执行此操作。'}
const en={title:'Password manager',loading:'Loading…','not-supported':'The built-in vault is unavailable in this desktop.','operation-failed':'Operation failed. Try again.','vault-unavailable':'System vault unavailable.','user-action-required':'Click to perform this action.'}
export function Settings({ t }) {
 const api=globalThis.eduworkPasswordSettings, zh=t('title')==='密码管理器'
 const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [query,setQuery]=useState(''),[limit,setLimit]=useState(50)
 useEffect(()=>{let active=true;if(!api){setState({status:'not-supported'});return}api.request({op:'builtin-snapshot'}).then(value=>{if(active)setState(value)}).catch(()=>{if(active)setError(t('operation-failed'))});return()=>{active=false}},[])
 const run=async request=>{setBusy(true);setError('');try{const value=await api.request(request);if(value.status!=='available')setError(t(value.status)||t('operation-failed'));else setState(value)}catch{setError(t('operation-failed'))}finally{setBusy(false)}}
 const copy=(cn,en)=>zh?cn:en
 const entries=state?.entries||[]
 const matches=searchAccounts(entries,query),visible=matches.slice(0,limit)
 const row=(title,description,control)=>h('div',{key:title,className:'pm-setting-row'},h('div',{className:'pm-row-copy'},h('div',{className:'pm-label'},title),h('p',{className:'pm-description'},description)),control)
 return h('section',{className:'eduwork-password-page'},
  h('header',{className:'pm-heading'},h('h3',null,t('title')),h('p',{className:'pm-description'},copy('登录后保存账号，再次访问时自动填写。密码由操作系统加密保存在本机。','Save accounts after sign-in and fill them on your next visit. Passwords are encrypted locally by the operating system.'))),
  state?.status==='available'?h(React.Fragment,null,
   row(copy('启用浏览器密码管理','Enable browser password manager'),copy('关闭后停止保存提示和填写，保留已保存账号及网站登录状态。','Turning off stops save prompts and filling; saved accounts and website sessions are kept.'),
    h(Switch,{checked:state.managerEnabled!==false,disabled:busy,label:copy('启用浏览器密码管理','Enable browser password manager'),onChange:enabled=>run({op:'builtin-manager-set',enabled})})),
   row(copy('允许 Agent 使用已保存账号','Allow Agent to use saved accounts'),copy('首次使用时选择账号，同一会话复用授权。','Choose an account on first use; authorization lasts for this conversation.'),
    h(Switch,{checked:state.enabled===true,disabled:busy||state.managerEnabled===false,label:copy('允许 Agent 使用已保存账号','Allow Agent to use saved accounts'),onChange:enabled=>run({op:'builtin-set',enabled})})),
   state.enabled&&state.managerEnabled!==false&&row(copy('会话授权','Conversation authorization'),copy('撤销后，下次 Agent 登录需要重新选择账号。','After revoking, the next Agent sign-in asks you to choose an account again.'),h(Button,{variant:'outline',size:'sm',disabled:busy,onClick:()=>run({op:'builtin-revoke'})},copy('撤销授权','Revoke'))),
   h('section',{className:'pm-group'},h('h4',null,copy('已保存账号','Saved accounts'),h('span',{className:'pm-count','aria-live':'polite'},query.trim()?`${matches.length} / ${entries.length}`:String(entries.length))),
    h(Input,{className:'pm-account-search',type:'search',icon:h(IconSearchOutlineRegular,{size:16}),'aria-label':copy('搜索已保存账号','Search saved accounts'),placeholder:copy('搜索网站或用户名','Search website or username'),value:query,onChange:event=>{setQuery(event.target.value);setLimit(50)}}),
    visible.length?visible.map(entry=>h('div',{key:entry.id,className:'pm-account-row'},h('div',{className:'pm-row-copy'},h('div',{className:'pm-label'},entry.username||copy('未命名账号','Unnamed account')),h('div',{className:'pm-description'},entry.origin)),h(Button,{variant:'ghost',size:'sm',disabled:busy,'aria-label':copy(`删除 ${entry.username||entry.origin}`,`Delete ${entry.username||entry.origin}`),onClick:()=>run({op:'builtin-delete',id:entry.id})},copy('删除','Delete'))))
    :h('p',{className:'pm-empty',role:'status'},entries.length?copy('没有匹配账号，请尝试其他网站或用户名。','No matching accounts. Try another website or username.'):copy('尚未保存账号。在内建浏览器中登录网站后，选择“保存密码”。','No saved accounts yet. Sign in using the built-in browser and choose Save password.')),
    matches.length>limit&&h(Button,{variant:'ghost',size:'sm',onClick:()=>setLimit(limit+50)},copy(`显示更多（剩余 ${matches.length-limit}）`,`Show more (${matches.length-limit} remaining)`))),
   state.never?.length>0&&h('section',{className:'pm-group'},h('h4',null,copy('不保存的网站','Never saved sites')),state.never.map(origin=>row(origin,'',h(Button,{key:origin,variant:'ghost',size:'sm',disabled:busy,onClick:()=>run({op:'builtin-allow-site',origin})},copy('恢复保存提示','Allow saving'))))),
   h('details',{className:'pm-details'},h('summary',null,copy('密码与 Agent 的访问范围','Password and Agent access')),h('p',{className:'pm-description'},copy('Agent 登录工具只返回状态。普通浏览器页面仍允许脚本和调试读取表单内容。关闭开关会取消进行中的 Agent 登录并撤销授权。','Agent login tools return status only. Ordinary page scripts and debugging can read form fields. Turning off the switch cancels Agent login and revokes grants.'))))
  :h('p',{className:'pm-description'},state?t('not-supported'):t('loading')),
  error&&h('p',{className:'pm-error',role:'status','aria-live':'polite'},error))
}
export async function apply(ctx) {
 ctx.locale.register(NS,{zh,en})
 const t=ctx.locale.bind(NS)
 ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:NS,order:13,locale:NS,label:()=>t('title'),inject:()=>({t})},Settings))
 for(const name of ['plugins.bundle.config','eduwork.extensions.config'])ctx.slots.inject(name,()=>ctx.slots.register({name,key:'@eduwork/dsh-password-manager',locale:NS,inject:()=>({t})},Settings))
 ctx.effect(()=>{const style=document.createElement('style');style.textContent=settingsStyle;document.head.append(style);return()=>style.remove()})
}
