const zh = {
  title: 'EduWork 远程访问',
  hosts: '已配对的电脑', noHosts: '这个浏览器还没有配对电脑。在电脑上打开“设置 → 远程访问 → 添加设备”，扫描二维码或打开链接。',
  open: '打开', forget: '忘记',
  pasteLabel: '配对链接', pastePlaceholder: '粘贴电脑上显示的链接', pasteGo: '继续', badLink: '这不是有效的配对链接。',
  pairTitle: '添加这台设备', deviceName: '设备名称', deviceNameHint: '电脑上会显示这个名字，方便你认出这台设备。', pairGo: '开始配对',
  iosInstall: '在 iPhone 和 iPad 上，请先把本页添加到主屏幕再配对：点“分享”→“添加到主屏幕”，从主屏幕打开后粘贴配对链接。只在 Safari 里配对的话，7 天不用就要重新配对。',
  copyLink: '复制配对链接', copied: '已复制', pairHere: '仍在这里配对',
  confirmTitle: '请在电脑上确认', confirmHint: '确认电脑上显示的配对码和这里一样，然后在电脑上点“允许”。',
  paired: '配对成功，正在打开…',
  refused: {
    'invalid-invite': '配对链接已失效（只能用一次，10 分钟内有效）。请在电脑上重新生成。',
    'unknown-device': '电脑不认识这台设备，请重新配对。',
    declined: '电脑拒绝了这次配对。',
    timeout: '电脑上没有人确认，配对已取消。',
    revoked: '这台设备已在电脑上被移除，需要重新配对。',
  },
  hostOffline: '电脑不在线：请确认电脑开着、EduWork 在运行，并已打开远程访问。',
  connectFailed: '连不上：{message}',
  connecting: '正在连接 {name}…', waitingOffline: '{name} 不在线，{seconds} 秒后重试', waitingLost: '连接中断，{seconds} 秒后重连',
  retry: '立即重试', back: '返回', update: '网页客户端有新版本。', reload: '重新加载',
  noServiceWorker: '这个浏览器不支持远程访问所需的 Service Worker（无痕模式下可能被禁用）。',
}

const en: typeof zh = {
  title: 'EduWork remote access',
  hosts: 'Paired computers', noHosts: 'This browser is not paired with a computer yet. On the computer, open Settings → Remote access → Add a device, then scan the QR code or open the link.',
  open: 'Open', forget: 'Forget',
  pasteLabel: 'Pairing link', pastePlaceholder: 'Paste the link shown on the computer', pasteGo: 'Continue', badLink: 'This is not a valid pairing link.',
  pairTitle: 'Add this device', deviceName: 'Device name', deviceNameHint: 'The computer shows this name so you can recognise the device.', pairGo: 'Pair',
  iosInstall: 'On iPhone and iPad, add this page to the Home Screen before pairing: tap Share → Add to Home Screen, open it from there and paste the pairing link. A pairing made only in Safari is lost after 7 days without use.',
  copyLink: 'Copy pairing link', copied: 'Copied', pairHere: 'Pair here anyway',
  confirmTitle: 'Confirm on the computer', confirmHint: 'Check that the computer shows the same pairing code, then choose Allow there.',
  paired: 'Paired. Opening…',
  refused: {
    'invalid-invite': 'The pairing link has expired (it works once, for 10 minutes). Create a new one on the computer.',
    'unknown-device': 'The computer does not know this device. Pair it again.',
    declined: 'The computer declined the pairing.',
    timeout: 'Nobody confirmed on the computer, so pairing was cancelled.',
    revoked: 'This device was removed on the computer. Pair it again.',
  },
  hostOffline: 'The computer is offline: check that it is on, EduWork is running and remote access is allowed.',
  connectFailed: 'Could not connect: {message}',
  connecting: 'Connecting to {name}…', waitingOffline: '{name} is offline; retrying in {seconds} s', waitingLost: 'Connection lost; reconnecting in {seconds} s',
  retry: 'Retry now', back: 'Back', update: 'A new version of the web client is available.', reload: 'Reload',
  noServiceWorker: 'This browser does not support the Service Worker remote access needs (private browsing may disable it).',
}

export const text = navigator.language.toLowerCase().startsWith('zh') ? zh : en

export const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
