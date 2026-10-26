// A Host can wait minutes on a plugin (for example one polling a QR login)
// while the BootPage only spins. boot-hint-preload.cjs shows this after 30 s
// with the elapsed time, so the user knows startup is alive and what to send.
export const startupHintMessage = logs => `可能有插件在等待扫码或网络。如长时间无进展，请退出后把日志发给管理员：${logs}`
