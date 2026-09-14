import { join, isAbsolute } from 'node:path'

// Publisher configurations use a new filename for every release. Old updaters
// merge missing config files, so this also works on the first upgraded launch.
// Keeping the old file intact lets an old executable roll back to its own config.
export function desktopConfigurationPath({root,version,ownership='user',override}) {
  if(!['user','publisher'].includes(ownership))throw Error('Unknown desktop configuration ownership')
  if(override){if(!isAbsolute(override))throw Error('EDUWORK_CONFIG_FILE must be an absolute path');return override}
  if(ownership==='user')return join(root,'config/eduwork.jsonc')
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:-dev\.\d{8}\.[1-9]\d*)?$/.test(version))throw Error('Publisher configuration requires an exact product version')
  return join(root,`config/eduwork.${version}.jsonc`)
}
