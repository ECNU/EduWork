import { join, isAbsolute } from 'node:path'

// Every edition reads the same editable file. Backups and migration metadata
// live in data; the executable version no longer chooses a configuration.
export function desktopConfigurationPath({root,version,ownership='user',override}) {
  if(!['user','publisher'].includes(ownership))throw Error('Unknown desktop configuration ownership')
  if(override){if(!isAbsolute(override))throw Error('EDUWORK_CONFIG_FILE must be an absolute path');return override}
  return join(root,'config/eduwork.jsonc')
}
