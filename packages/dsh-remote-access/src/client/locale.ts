export const NS = 'settings.remoteAccess'

const zh = {
  locale: 'zh-CN', nav: '远程访问', title: '远程访问',
  intro: '在手机或其他电脑的浏览器里使用这台电脑上的 EduWork。连接经中继服务器转发并端到端加密，中继看不到内容。新设备要先在这里确认，之后可随时移除。',
  loading: '正在读取远程访问状态…', saveFailed: '设置未保存，请重试。',
  enabled: '允许远程访问',
  relay: '中继服务器', relayHint: '中继服务器的地址，例如 https://remote.example.edu',
  accessKey: '接入密钥', accessKeyHint: '由中继服务器的管理员提供。', accessKeySet: '已设置，输入新密钥可替换', accessKeyMissing: '未设置',
  hostName: '电脑名称', hostNameHint: '配对和连接时显示在设备上；留空使用本机名称。',
  unconfigured: '填写中继服务器和接入密钥后，远程访问才会开始。',
  failed: '远程访问没有启动：{message}',
  linkConnecting: '正在连接中继服务器…', linkOnline: '已连接中继服务器，可以添加设备。',
  linkOffline: '暂时连不上中继服务器（{reason}），稍后自动重试。',
  linkRefused: '中继服务器拒绝了这台电脑（{reason}）。请检查接入密钥，或升级到中继支持的版本。',
  linkReplaced: '同一身份在另一个进程里连上了中继，这里已停止。关闭再打开“允许远程访问”可恢复。',
  addDevice: '添加设备',
  inviteHint: '用要添加的设备扫描二维码，或在它的浏览器里打开下面的链接。链接只能用一次，{time} 前有效。',
  copy: '复制链接', copied: '已复制', cancelInvite: '取消', qr: '配对二维码',
  pending: '“{name}”请求连接', pendingHint: '请确认设备上显示的配对码与这里一致：',
  approve: '允许', decline: '拒绝', unnamed: '未命名设备',
  devices: '已配对设备', noDevices: '还没有配对的设备。',
  pairedAt: '配对于 {time}', lastSeen: '最近连接 {time}', deviceOnline: '在线', remove: '移除',
}

const en: typeof zh = {
  locale: 'en', nav: 'Remote access', title: 'Remote access',
  intro: 'Use EduWork on this computer from a browser on your phone or another computer. The connection passes through a relay server and is end-to-end encrypted, so the relay cannot read it. Each new device must be confirmed here first and can be removed at any time.',
  loading: 'Loading remote access…', saveFailed: 'The setting was not saved. Please try again.',
  enabled: 'Allow remote access',
  relay: 'Relay server', relayHint: 'Address of the relay server, for example https://remote.example.edu',
  accessKey: 'Access key', accessKeyHint: 'Provided by the administrator of the relay server.', accessKeySet: 'Set. Enter a new key to replace it', accessKeyMissing: 'Not set',
  hostName: 'Computer name', hostNameHint: 'Shown on devices while pairing and connecting; this computer\'s own name when empty.',
  unconfigured: 'Remote access starts once the relay server and the access key are filled in.',
  failed: 'Remote access did not start: {message}',
  linkConnecting: 'Connecting to the relay server…', linkOnline: 'Connected to the relay server. You can add devices.',
  linkOffline: 'The relay server is unreachable ({reason}); retrying shortly.',
  linkRefused: 'The relay server refused this computer ({reason}). Check the access key, or update to a version the relay supports.',
  linkReplaced: 'Another process connected to the relay with the same identity, so this one stopped. Turn "Allow remote access" off and on to take over.',
  addDevice: 'Add a device',
  inviteHint: 'Scan the QR code with the device to add, or open the link below in its browser. The link works once, until {time}.',
  copy: 'Copy link', copied: 'Copied', cancelInvite: 'Cancel', qr: 'Pairing QR code',
  pending: '"{name}" wants to connect', pendingHint: 'Check that the device shows the same pairing code:',
  approve: 'Allow', decline: 'Decline', unnamed: 'Unnamed device',
  devices: 'Paired devices', noDevices: 'No devices are paired yet.',
  pairedAt: 'Paired {time}', lastSeen: 'Last connected {time}', deviceOnline: 'Online', remove: 'Remove',
}

export type Key = keyof typeof zh
export const dictionaries = { zh, en }
