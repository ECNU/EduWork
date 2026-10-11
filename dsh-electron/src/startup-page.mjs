const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function startupPage({ title, logo, blue = false }) {
  const background = blue ? '#f6f7f9' : '#faf3ef'
  const accent = blue ? '#2575ff' : '#9f2636'
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:${background};color:#302b29;font:14px/1.6 "Segoe UI","Microsoft YaHei UI",system-ui,sans-serif}
    main{width:100%;padding:36px 42px}header{display:flex;align-items:center;gap:12px;font-weight:600}header img{width:42px;height:42px}h1{font-size:26px;font-weight:600;letter-spacing:-.5px;margin:24px 0 6px}p{margin:0;color:#80716b;min-height:24px}
    .track{margin-top:28px;border:1px solid #eaded8;background:#fffdfb;border-radius:16px;padding:18px 20px}progress{display:block;width:100%;height:6px;border:0;border-radius:8px;overflow:hidden;accent-color:${accent};background:#eee4e0}progress::-webkit-progress-bar{background:#eee4e0;border-radius:8px}
    progress:indeterminate{background:linear-gradient(90deg,#eee4e0 30%,${accent} 50%,#eee4e0 70%);background-size:250% 100%;animation:prepare 1.8s ease-in-out infinite}progress:indeterminate::-webkit-progress-bar{background:transparent}@keyframes prepare{from{background-position:100% 0}to{background-position:0 0}}
    small{display:block;color:#978781;margin-top:12px;font-size:12px}@media(prefers-reduced-motion:reduce){*{animation:none!important}}
    </style><main><header><img alt="" src="${escape(logo)}"><span>${escape(title)}</span></header><h1>正在准备你的工作空间</h1><p role="status" aria-live="polite">正在准备本机工作环境…</p><div class="track"><progress aria-label="启动准备进度"></progress><small>准备完成后，将自动进入应用</small></div></main></html>`
}
