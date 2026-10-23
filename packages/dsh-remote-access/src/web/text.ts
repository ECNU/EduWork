const zh = {
  title: 'EduWork 远程访问',
  hosts: '已配对的电脑', noHosts: '此浏览器尚未配对电脑。请在电脑上打开“设置 → 远程访问 → 添加设备”，然后扫描二维码或打开链接。',
  open: '打开', forget: '移除',
  pasteLabel: '配对链接', pastePlaceholder: '粘贴电脑上显示的配对链接', pasteGo: '继续', badLink: '配对链接无效。',
  pairTitle: '添加这台设备', deviceName: '设备名称', deviceNameHint: '将显示在电脑上，用于识别此设备。', pairGo: '开始配对',
  pairOwn: '请只与自己的电脑配对。配对后，这台电脑提供的界面将在此浏览器中运行，并可使用此浏览器与其他电脑的配对。',
  iosInstall: '在 iPhone 或 iPad 上，请先将本页添加到主屏幕（“分享”→“添加到主屏幕”），再从主屏幕打开并粘贴配对链接。仅在 Safari 中配对时，7 天未使用需重新配对。',
  copyLink: '复制配对链接', copied: '已复制', pairHere: '仍在此处配对',
  confirmTitle: '请在电脑上确认', confirmHint: '请核对电脑上显示的配对码与此处一致，然后在电脑上点击“允许”。',
  paired: '配对成功，正在打开…',
  refused: {
    'invalid-invite': '配对链接已失效，请在电脑上重新添加设备。',
    'unknown-device': '此设备已不在电脑的配对列表中，请重新配对。',
    declined: '电脑已拒绝此次配对。',
    timeout: '电脑未确认，配对已取消。',
    revoked: '此设备已在电脑上被移除，请重新配对。',
  },
  hostOffline: '电脑不在线。请确认电脑已开机、EduWork 正在运行且已开启远程访问。',
  connectFailed: '连接失败，请稍后重试。',
  connecting: '正在连接“{name}”…', waitingOffline: '“{name}”不在线，{seconds} 秒后重试', waitingLost: '连接已断开，{seconds} 秒后重连',
  retry: '立即重试', back: '返回', update: '有新版本可用。', reload: '重新加载',
  noServiceWorker: '此浏览器不支持远程访问，请换用其他浏览器或退出无痕模式。',
}

const en: typeof zh = {
  title: 'EduWork remote access',
  hosts: 'Paired computers', noHosts: 'This browser is not paired with a computer. On the computer, open Settings → Remote access → Add a device, then scan the QR code or open the link.',
  open: 'Open', forget: 'Remove',
  pasteLabel: 'Pairing link', pastePlaceholder: 'Paste the pairing link shown on the computer', pasteGo: 'Continue', badLink: 'Invalid pairing link.',
  pairTitle: 'Add this device', deviceName: 'Device name', deviceNameHint: 'Shown on the computer to identify this device.', pairGo: 'Pair',
  pairOwn: 'Pair only with your own computer. Once paired, the interface it provides runs in this browser and can use this browser\'s pairings with other computers.',
  iosInstall: 'On iPhone or iPad, first add this page to the Home Screen (Share → Add to Home Screen), then open it from there and paste the pairing link. A pairing made only in Safari expires after 7 days without use.',
  copyLink: 'Copy pairing link', copied: 'Copied', pairHere: 'Pair here anyway',
  confirmTitle: 'Confirm on the computer', confirmHint: 'Check that the computer shows the same pairing code, then click Allow on the computer.',
  paired: 'Paired. Opening…',
  refused: {
    'invalid-invite': 'This pairing link has expired. Add the device again on the computer.',
    'unknown-device': 'This device is no longer paired with the computer. Pair it again.',
    declined: 'The computer declined the pairing.',
    timeout: 'The pairing was not confirmed on the computer and has been cancelled.',
    revoked: 'This device was removed on the computer. Pair it again.',
  },
  hostOffline: 'The computer is offline. Check that it is on, EduWork is running and remote access is allowed.',
  connectFailed: 'Could not connect. Please try again later.',
  connecting: 'Connecting to "{name}"…', waitingOffline: '"{name}" is offline. Retrying in {seconds} s', waitingLost: 'Disconnected. Reconnecting in {seconds} s',
  retry: 'Retry now', back: 'Back', update: 'A new version is available.', reload: 'Reload',
  noServiceWorker: 'This browser does not support remote access. Use another browser or leave private browsing.',
}

export const text = navigator.language.toLowerCase().startsWith('zh') ? zh : en

export const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
