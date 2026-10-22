const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export function startupPage({ productName, logo, background, accent }) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape(productName)}</title>
    <style>
      body { font:16px system-ui; padding:36px; color:#313744; background:${background} }
      h2 { display:flex; align-items:center; gap:12px }
      .startup-progress { width:100%; height:8px; margin-top:40px; overflow:hidden;
        box-sizing:border-box; border:1px solid #b8b8b8; border-radius:999px; background:#efefef }
      .startup-progress-bar { display:block; width:20%; height:100%; border-radius:inherit;
        background:${accent}; will-change:transform;
        animation:eduwork-startup-motion 1.8s cubic-bezier(.45,0,.55,1) infinite alternate }
      /* A 20%-wide indicator travels four of its own widths, inside the track. */
      @keyframes eduwork-startup-motion {
        from { transform:translate3d(0,0,0) }
        to { transform:translate3d(400%,0,0) }
      }
      @media (prefers-reduced-motion:reduce) {
        .startup-progress-bar { animation:none; transform:translate3d(200%,0,0); will-change:auto }
      }
    </style>
    <h2><img alt="" width="40" height="40" src="${escape(logo)}">正在启动 ${escape(productName)}</h2>
    <p role="status">正在准备本机工作环境…</p>
    <div class="startup-progress" role="progressbar" aria-label="正在准备本机工作环境" aria-busy="true">
      <span class="startup-progress-bar" aria-hidden="true"></span>
    </div></html>`
}
