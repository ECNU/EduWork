import { progressResult, requestParameter, snapshotResult } from './typert-schemas.js'

const pkg = '@chatecnu-work/dsh-activity-insights-native'
const snapshotDescriptor = {
  id: `${pkg}#activityInsights/snapshot`, service: 'activityInsights', namespace: 'activityInsights', method: 'snapshot',
  invocation: { kind: 'direct' }, parameters: [requestParameter], result: snapshotResult,
  sourceLocation: { file: 'dsh-plugins/activity-insights-native/lib/index.js', line: 1, column: 1 },
}
const progressDescriptor = {
  id: `${pkg}#activityInsights/progress`, service: 'activityInsights', namespace: 'activityInsights', method: 'progress',
  invocation: { kind: 'direct' }, parameters: [], result: progressResult,
  sourceLocation: { file: 'dsh-plugins/activity-insights-native/lib/index.js', line: 1, column: 1 },
}
export const TYPERT = { package: pkg, face: 'host', schemas: [], invocations: [snapshotDescriptor, progressDescriptor], model: { services: [], events: [], objects: [] } }
export default TYPERT
