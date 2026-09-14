import {expect} from '@playwright/test'

/** Exercise the host's public controls; never install replacement entry UI. */
export function studioNavigation(page){
 const legacy=page.getByRole('button',{name:'Studio 工作区',exact:true})
 const tab=page.getByRole('tab').filter({has:page.locator('[data-dockkit-tab-title]',{hasText:/^Studio$/})})
 const open=async()=>{
  if(await legacy.count()){
   if(await legacy.getAttribute('aria-pressed')!=='true')await legacy.click()
   return
  }
  const expand=page.locator('[data-sidebar-right-expand]')
  if(await expand.count())await expand.click()
  if(await tab.count()){await tab.click();return}
  const guide=page.getByRole('button',{name:'Studio 从工作区资料创建成果',exact:true})
  if(!await guide.isVisible())await page.getByRole('button',{name:'新标签页',exact:true}).click()
  await guide.click();await expect(tab).toHaveCount(1)
 }
 const close=async()=>{
  if(await legacy.count()){await legacy.click();return}
  const back=page.getByRole('button',{name:'返回对话',exact:true})
  if(await back.isVisible())await back.click()
  await tab.locator('[data-dockkit-tab-close]').click();await expect(tab).toHaveCount(0)
 }
 const fullscreen=async()=>{
  if(await legacy.count()){await page.getByRole('button',{name:'展开阅读',exact:true}).click();return}
  const toggle=page.locator('[data-sidebar-right-mode="fullscreen"]')
  if(await toggle.count())await toggle.click()
  await expect(page.locator('[data-sidebar-right-panel="fullscreen"]')).toBeVisible()
  await expect(page.locator('[data-studio-reading-layer]')).toHaveCount(0)
  await expect(page.getByRole('button',{name:/^展开阅读/})).toHaveCount(0)
 }
 const exitFullscreen=async()=>{
  if(await legacy.count()){const back=page.getByRole('button',{name:'返回对话',exact:true});if(await back.isVisible())await back.click();return}
  const toggle=page.locator('[data-sidebar-right-mode="push"]')
  if(await toggle.count())await toggle.click()
 }
 return {open,close,fullscreen,exitFullscreen,click:async()=>{
  if(await legacy.count())await legacy.click()
  else if(await tab.count())await close()
  else await open()
 }}
}
