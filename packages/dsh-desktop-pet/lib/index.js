import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SKIN } from './skin.js'
import { readBuiltinSkins } from './skin-files.js'

const initializers = []
// The pet window belongs to the desktop shell. This Host part keeps the
// settings, offers the validated skins and tells the shell what to show.
export default class DesktopPet extends TypertRemoteService {
  static inject = ['desktopServices']
  // Deployment defaults come from eduwork.jsonc `desktop.pet`; choices saved
  // in Settings are stored in this plugin's configuration and apply live.
  static Config = z.object({
    enabled: z.boolean().default(false).volatile(),
    skin: z.string().default(DEFAULT_SKIN).volatile(),
    size: z.natural().min(50).max(200).step(10).default(100).volatile(),
    bubbles: z.boolean().default(true).volatile(),
    sleep: z.boolean().default(true).volatile(),
  })
  constructor(ctx, config) {
    super(ctx, 'desktopPet')
    for (const init of initializers) init.call(this)
    this.config = config
    this.disposed = false
    this.skins = readBuiltinSkins(fileURLToPath(new URL('../skins/', import.meta.url)), message => ctx.logger.warn(message))
    this.applied = Promise.resolve()
    const apply = () => { if (!this.disposed) this.applied = this.applied.then(() => this.apply()) }
    ctx.on('loader/volatile-update', apply)
    apply()
    // Stopping or disabling the plugin removes the pet; the shell keeps no copy.
    const services = ctx.desktopServices
    ctx.effect(() => () => {
      this.disposed = true
      // Let the loader await the last request and the final hide before it
      // starts a replacement instance. Older work must not hide a new pet.
      this.applied = this.applied.then(async () => services.pet({ ...this.request(await this.skins), enabled: false }))
        .catch(error => ctx.logger.warn(`desktop-pet cleanup: ${error.message}`))
      return this.applied
    })
  }
  request(skins) {
    const selected = this.config.skin.get(), id = skins.has(selected) ? selected : DEFAULT_SKIN
    return { action: 'configure', enabled: this.config.enabled.get(), skin: id, frame: skins.get(id).skin.frame,
      size: this.config.size.get(), bubbles: this.config.bubbles.get(), sleep: this.config.sleep.get() }
  }
  async apply() {
    try {
      const skins = await this.skins
      if (this.disposed) return
      this.supported = (await this.ctx.desktopServices.pet(this.request(skins))).supported !== false
    }
    catch (error) { this.ctx.logger.warn(`desktop-pet: ${error.message}`) }
  }
  async status() {
    await this.applied
    const skins = [...(await this.skins).values()].map(({ skin, preview }) => ({ id: skin.id, name: skin.name, ...skin.author ? { author: skin.author } : {}, preview }))
    return { supported: this.supported === true, skins }
  }
  async resetPosition() {
    return { supported: (await this.ctx.desktopServices.pet({ action: 'reset-position' })).supported !== false }
  }
}
for (const name of ['status', 'resetPosition']) Remote(name)(DesktopPet.prototype[name], {
  kind: 'method', name, static: false, private: false, addInitializer(init) { initializers.push(init) },
})
