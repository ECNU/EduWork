import assert from 'node:assert/strict'

// Shared by the browser smoke and local acceptance with a converted DOCX.
export async function verifyOfficePreviewZoom(page,{container='#one',viewer='one'}={}) {
  const original=await page.evaluate(({container})=>{
    const element=document.querySelector(container),root=element.querySelector('[data-office-preview-viewer]').shadowRoot
    const style=document.createElement('style');style.dataset.zoomRegression='';root.append(style)
    const original=element.style.cssText;element.style.flex='none'
    return original
  },{container})
  const results=[]
  async function sample({width,height,mode,scrollbars,manual}) {
    return page.evaluate(async({container,viewer,width,height,mode,scrollbars,manual})=>{
      const element=document.querySelector(container),host=element.querySelector('[data-office-preview-viewer]'),root=host.shadowRoot
      element.style.width=`${width}px`;element.style.height=`${height}px`
      root.querySelector('[data-zoom-regression]').textContent=scrollbars==='classic'?'.viewport::-webkit-scrollbar{width:16px;height:16px}.viewport::-webkit-scrollbar-thumb{background:#999}':''
      if(mode==='manual') {
        if(manual!==undefined) {
          root.querySelector('[aria-label="原始尺寸 100%"]').click()
          if(manual===1.2)root.querySelector('[aria-label="放大"]').click()
        }
      } else {
        const select=root.querySelector('select');select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}))
      }
      const viewport=root.querySelector('.viewport'),stage=root.querySelector('.stage'),frame=root.querySelector('iframe'),samples=[]
      for(let i=0;i<12;i++) {
        await new Promise(requestAnimationFrame)
        if(i>=4) {
          const outer=viewport.getBoundingClientRect(),page=stage.getBoundingClientRect()
          samples.push({scale:window[viewer].getState().scale,mode:host.dataset.officeMode,width:viewport.clientWidth,height:viewport.clientHeight,scrollWidth:viewport.scrollWidth,scrollHeight:viewport.scrollHeight,frameWidth:frame.style.width,frameHeight:frame.style.height,stageWidth:page.width,stageHeight:page.height,availableWidth:outer.width-24-(viewport.offsetWidth-viewport.clientWidth),availableHeight:outer.height-24-(viewport.offsetHeight-viewport.clientHeight)})
        }
      }
      return samples
    },{container,viewer,width,height,mode,scrollbars,manual})
  }
  try {
    // Fractional width alone reproduces 59% <-> 61%; fractional height must
    // also be covered because either scrollbar can change the other axis.
    for(const scrollbars of ['classic','native'])for(const mode of ['fit-page','fit-width']) {
      for(const [width,height] of [[574.5,800],[575,800.5],[320.5,480.5],[840,650]]) {
        const samples=await sample({width,height,mode,scrollbars}),first=samples[0]
        assert.ok(samples.every(value=>Math.abs(value.scale-first.scale)<1e-9),`${scrollbars} ${mode} ${width}x${height}: auto zoom must settle across animation frames`)
        assert.ok(samples.every(value=>value.scrollWidth<=value.width&&value.scrollHeight<=value.height),`${scrollbars} ${mode}: the fitted document must not create outer scrollbars`)
        // Headless browsers can suppress scrollbar layout. Check painted bounds
        // too, so fractional overshoot is still caught in that environment.
        assert.ok(samples.every(value=>value.stageWidth<=value.availableWidth+1/64&&value.stageHeight<=value.availableHeight+1/64),`${scrollbars} ${mode}: the fitted page must stay inside the fractional content area`)
        assert.ok(samples.every(value=>value.mode===mode&&value.frameWidth==='900px'), 'auto zoom retains the document coordinate system')
        results.push({scrollbars,mode,width,height,scale:first.scale,stableFrames:samples.length})
      }
      const narrow=results.at(-2),wide=results.at(-1)
      assert.ok(wide.scale>narrow.scale,'auto zoom still follows a real container resize')
    }
    for(const manual of [1,1.2])for(const [width,height] of [[574.5,800],[320.5,480.5]]) {
      const samples=await sample({width,height,mode:'manual',scrollbars:'classic',manual:width===574.5?manual:undefined})
      assert.ok(samples.every(value=>value.mode==='manual'&&value.scale===manual),'manual zoom remains exact across fractional resizes')
      assert.ok(samples.every(value=>value.scrollWidth>value.width),'manual zoom keeps the outer viewport scrollable')
      results.push({mode:'manual',width,height,scale:manual,stableFrames:samples.length})
    }
    return results
  } finally {
    await page.evaluate(({container,original})=>{
      const element=document.querySelector(container)
      element.querySelector('[data-office-preview-viewer]').shadowRoot.querySelector('[data-zoom-regression]').remove()
      element.style.cssText=original
    },{container,original})
  }
}
