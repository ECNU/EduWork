// Keep the upstream BootPage compatible with the system reduced-motion
// preference. The selector is limited to the boot page and its stable marker.
const style = document.createElement('style')
style.textContent = '@media (prefers-reduced-motion: reduce){[data-dsh-boot] [data-dsh-boot-spinner]{animation:none!important}}'
const install = () => { (document.head ?? document.documentElement)?.append(style) }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true })
else install()
