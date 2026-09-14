import { progressResult, requestParameter, snapshotResult } from './typert-schemas.js'

const pkg = '@chatecnu-work/dsh-activity-insights-native'
export default {
  package: pkg,
  descriptors: [{
    id: `${pkg}#activityInsights/snapshot`, service: 'activityInsights', namespace: 'activityInsights', method: 'snapshot',
    invocation: { kind: 'direct' }, parameters: [requestParameter], result: snapshotResult,
    sourceLocation: { file: 'dsh-plugins/activity-insights-native/lib/index.js', line: 1, column: 1 },
  }, {
    id: `${pkg}#activityInsights/progress`, service: 'activityInsights', namespace: 'activityInsights', method: 'progress',
    invocation: { kind: 'direct' }, parameters: [], result: progressResult,
    sourceLocation: { file: 'dsh-plugins/activity-insights-native/lib/index.js', line: 1, column: 1 },
  }],
}
