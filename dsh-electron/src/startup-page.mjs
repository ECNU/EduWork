const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function startupPage({ productName, logo, background = '#faf3ef', accent = '#9f2636' }) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(productName)}</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:${background};color:#302b29;font:14px/1.6 "Segoe UI","Microsoft YaHei UI",system-ui,sans-serif}
    main{width:100%;padding:36px 42px}header{display:flex;align-items:center;gap:12px;font-weight:600}header img{width:42px;height:42px}h1{font-size:26px;font-weight:600;letter-spacing:-.5px;margin:24px 0 6px}p{margin:0;color:#80716b;min-height:24px}
    .track{margin-top:28px;border:1px solid #eaded8;background:#fffdfb;border-radius:16px;padding:18px 20px}
    .startup-progress{width:100%;height:6px;overflow:hidden;border-radius:8px;background:#eee4e0}
    .startup-progress-bar{display:block;width:20%;height:100%;border-radius:inherit;background:${accent};will-change:transform;animation:eduwork-startup-motion 1.8s cubic-bezier(.45,0,.55,1) infinite alternate}
    @keyframes eduwork-startup-motion{from{transform:translate3d(0,0,0)}to{transform:translate3d(400%,0,0)}}
    small{display:block;color:#978781;margin-top:12px;font-size:12px}
    @media(prefers-reduced-motion:reduce){.startup-progress-bar{animation:none;transform:translate3d(200%,0,0);will-change:auto}}
    </style><main><header><img alt="" src="${escape(logo)}"><span>${escape(productName)}</span></header><h1>正在准备你的工作空间</h1><p role="status" aria-live="polite">正在准备本机工作环境…</p><div class="track"><div class="startup-progress" role="progressbar" aria-label="启动准备进度" aria-busy="true"><span class="startup-progress-bar" aria-hidden="true"></span></div><small>准备完成后，将自动进入应用</small></div></main></html>`
}
