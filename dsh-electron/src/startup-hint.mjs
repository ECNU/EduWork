export function startupHintMessage(logs, locale) {
  return locale !== 'zh-CN'
    ? `Still starting after {seconds} seconds. If startup stalls, check the logs in ${logs}`
    : `已等待 {seconds} 秒。如长时间没有进展，可查看启动日志：${logs}`
}
