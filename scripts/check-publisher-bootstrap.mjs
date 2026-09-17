import { readPublisherBootstrap } from '../dsh-host/publisher-bootstrap.mjs'

const [product, ownership] = process.argv.slice(2)
if (!product || !['user', 'publisher'].includes(ownership)) throw Error('Use <product-directory> <user|publisher>')
const config = await readPublisherBootstrap({ product, ownership })
console.log(JSON.stringify({ enabled: !!config,
  softwareUpdates: !!config && config.updates.provider !== 'disabled' && !!(config.updates.manifestURL || config.updates.repository) }))
