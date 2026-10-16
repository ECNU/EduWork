// Desktop pet page bridge: geometry and pointer intent only. No Host
// credentials, conversation data beyond the pet status, or commands.
const { contextBridge, ipcRenderer } = require('electron')

const events = ['init', 'status', 'settings', 'presence', 'placement', 'pointer', 'drag-direction']
const send = (name, value) => ipcRenderer.send(`eduwork-pet:${name}`, value)
contextBridge.exposeInMainWorld('eduworkPet', Object.freeze({
  on(name, listener) {
    if (!events.includes(name) || typeof listener !== 'function') throw new Error('Unknown pet event')
    ipcRenderer.on(`eduwork-pet:${name}`, (_event, value) => listener(value))
  },
  ready: () => send('ready'),
  failed: message => send('failed', String(message)),
  interactive: value => send('interactive', value === true),
  dragStart: (x, y) => send('drag-start', { x: Number(x), y: Number(y) }),
  dragEnd: () => send('drag-end'),
  untuck: () => send('untuck'),
  open: key => send('open', String(key)),
  menu: () => send('menu'),
}))
