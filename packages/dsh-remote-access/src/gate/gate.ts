/**
 * What a paired device may ask this Host to do. Requests from the tunnel reach
 * DSH as the owner without browser authentication, so this table is the only
 * narrowing: everything not listed here is refused.
 *
 * First version (#116 review): work with existing workspaces, view and create
 * sessions, continue and cancel tasks, approve and answer, view and download
 * results, and use the content the interface works on (EduWork's Studio
 * results and calendar). Refused: anything that acts on the Host's desktop
 * (windows, programs, notifications), registers or removes workspaces, or
 * administers the Host (settings and what they manage, accounts, credentials,
 * plugins, skills, terminals, code execution, remote access itself).
 *
 * The starting list follows PR #180's endpoint mapping by Paraso42. EduWork's
 * own endpoints are classified from its 0.4.6 desktop composition.
 */
import { isDeepStrictEqual } from 'node:util'

/** Gateway RPC and stream endpoints (`namespace/method`). */
const ALLOWED_ENDPOINTS = new Set([
  // Connection: the forwarded-event stream and its result channel (approvals are answered here).
  '$events', '$events/result',
  // Sessions and the agent's own work.
  'session/attachment', 'session/cancel', 'session/control', 'session/create', 'session/follow', 'session/fork',
  'session/initializeDefaultModel', 'session/list', 'session/modelCatalog', 'session/page', 'session/projections',
  'session/prompt', 'session/rename', 'session/search', 'session/selectModel', 'session/updateQueue',
  'sessionFeedback/record', 'sessionReferenceResolver/candidates', 'messageFeedback/delete', 'messageFeedback/list', 'messageFeedback/put',
  'userQuestions/answer', 'userQuestions/attachWait',
  'goals/clear', 'goals/complete', 'goals/create', 'goals/edit', 'goals/get', 'goals/pause', 'goals/resume',
  'subagents/interruptByParent', 'subagents/list', 'subagents/prompt',
  'job/follow', 'job/kill', 'job/list',
  'commands/execute', 'commands/list',
  'fileReferences/list', 'fileUploads/upload',
  'workspaceFiles/changes', 'workspaceFiles/list', 'workspaceFiles/read', 'workspaceFiles/readAll', 'workspaceFiles/readBytes',
  'workspaceFiles/readRelated', 'workspaceFiles/stat',
  'officeToPdf/generation', 'officeToPdf/render', 'artifactPreview/read', 'artifactPreview/importFiles',
  // EduWork's Studio results.
  'knowledgeStudio/artifactAskPrompt', 'knowledgeStudio/exportArtifact', 'knowledgeStudio/invokeStudio', 'knowledgeStudio/listArtifacts',
  'knowledgeStudio/listCapabilities', 'knowledgeStudio/manageArtifact', 'knowledgeStudio/readArtifact', 'knowledgeStudio/readEvidence',
  'knowledgeStudio/readUIPreferences', 'knowledgeStudio/setUIOpenPreference', 'knowledgeStudio/updateArtifactInteraction',
  'knowledgeStudio/workspaceForPath', 'knowledgeStudio/workspaceStatus',
  // EduWork's calendar: the owner's schedule, which the agent's calendar tools also read and change.
  'calendar/ackReminder', 'calendar/applyOverride', 'calendar/applySource', 'calendar/cancelOccurrence', 'calendar/changes',
  'calendar/deleteCalendar', 'calendar/deleteEvent', 'calendar/exportIcs', 'calendar/importIcs', 'calendar/notes', 'calendar/occurrences',
  'calendar/personalFor', 'calendar/putEvent', 'calendar/putNote', 'calendar/reminders', 'calendar/removeNote', 'calendar/removeOverride',
  'calendar/restoreOccurrence', 'calendar/setPersonal', 'calendar/snapshot', 'calendar/sourceStatuses', 'calendar/unlinkedNotes',
  'calendar/updateEvent',
  // Organising existing workspaces.
  'workspace/archiveSession', 'workspace/follow', 'workspace/insertBefore', 'workspace/insertSessionBefore', 'workspace/pinSession',
  'workspace/rename', 'workspace/unarchiveSession', 'workspace/unpinSession',
  'schedule/catalog', 'schedule/delete', 'schedule/history', 'schedule/list', 'schedule/update',
  // Read-only descriptions the interface paints from.
  'settings/describe', 'credentials/describe', 'llm/listConfigurableProviders', 'llm/listProviders', 'skills/list',
  'agentPresets/list', 'agentPresets/read', 'agentPresets/select', 'permissionPresets/catalog',
  'pluginInventory/list', 'productComponents/list',
  'account/ackBonusNotified', 'account/getBalance', 'account/getProfile', 'account/getState', 'account/getUnnotifiedBonuses',
  'account/hasRunningAccountTasks', 'account/watch', 'account/watchExpiry',
  'activityInsights/progress', 'activityInsights/snapshot', 'desktopPet/status', 'localMemories/listRecords', 'localMemories/stats',
  'skillManager/list', 'workbench/catalog',
  // EduWork's institution accounts: what is signed in, and refreshing a sign-in that already exists.
  'oidcAccounts/configuration', 'oidcAccounts/loginStatus', 'oidcAccounts/management', 'oidcAccounts/reconcile',
  'oidcAccounts/resources', 'oidcAccounts/status',
])

/**
 * Exact Fetch routes under `/api` (DSH serves them to the owner without the
 * Gateway's access checks) and the methods a device may use on them.
 */
const ALLOWED_ROUTES = new Map([
  ['/api/file', ['GET', 'HEAD']],
  ['/api/session/uploadFileBinary', ['POST']],
  ['/api/present.host', ['GET']],
  ['/api/changes.summary', ['GET']],
  ['/api/changes.diff', ['GET']],
  ['/api/session.export', ['GET', 'HEAD']],
  ['/api/artifactPreview/file', ['GET', 'HEAD']],
])

/**
 * Endpoints a device may call with particular arguments only. A web interface
 * asks its owner to acknowledge DSH's preview notice and records that with a
 * settings write. A desktop Host never shows the notice itself, so without this
 * a device would stop at it; no other setting may change.
 */
const ALLOWED_CALLS = new Map<string, (args: Record<string, unknown>) => boolean>([
  ['settings/mutate', ({ ns, ops }) => {
    if (ns !== 'ui-settings-general' || !Array.isArray(ops) || ops.length !== 1) return false
    const { op, path, value, ...rest } = Object(ops[0]) as Record<string, unknown>
    return op === 'set' && isDeepStrictEqual(path, ['welcomeNoticeVersion']) && typeof value === 'string' && Object.keys(rest).length === 0
  }],
])

/**
 * Refused on purpose, by reason. Anything unlisted is refused the same way at
 * run time; this list exists so that every endpoint of an assembled product
 * is classified by someone (see the coverage test), never allowed by accident.
 */
export const REFUSED: Readonly<Record<string, readonly string[]>> = {
  'acts on the Host\'s desktop': [
    'directoryPicker/createDirectory', 'directoryPicker/list', 'directoryPicker/pick',
    'session/canOpenWorkspacePath', 'session/openWorkspacePath', 'session/workspacePathApplications',
    'settings/openSettingsDocument', 'settings/canOpenAgentPresetDirectory', 'settings/openAgentPresetDirectory',
    'artifactPreview/reveal', 'artifactPreview/importNativeFiles', 'account/startSignIn', 'account/cancelSignIn',
    'oidcAccounts/begin', 'oidcAccounts/cancelLogin', 'oidcAccounts/openConfiguration',
    'desktopPet/resetPosition', 'workbench/notificationView',
    '/api/present.open', '/api/changes.open',
  ],
  'registers or removes workspaces': ['workspace/create', 'workspace/delete', 'workspace/initializeDefault'],
  'administers the Host': [
    'credentials/set', 'credentials/unset', 'settings/mutate', 'settings/replace', 'settings/update',
    'llm/discoverModels', 'account/signOut', 'agentPresets/copy', 'agentPresets/deletePreset',
    'pluginManager/cancelInstall', 'pluginManager/inspect', 'pluginManager/installBundle', 'pluginManager/listBundles',
    'pluginManager/listPlugins', 'pluginManager/listVersionExemptions', 'pluginManager/registries', 'pluginManager/removeBundle',
    'pluginManager/setBundleEnabled', 'pluginManager/setPluginEnabled', 'pluginManager/setVersionExemption', 'pluginManager/waitForInstall',
    'pluginRegistryProbe/fastest',
    'oidcAccounts/activate', 'oidcAccounts/addCustom', 'oidcAccounts/configure', 'oidcAccounts/configureModels', 'oidcAccounts/logout',
    'oidcAccounts/removeProfile', 'oidcAccounts/restart', 'oidcAccounts/selectEnterpriseModel', 'oidcAccounts/updateCustom',
    'localMemories/deleteAll', 'localMemories/deleteRecord', 'localMemories/exportData', 'localMemories/importData',
    'localMemories/setRecordPinned', 'localMemories/undoDelete', 'localMemories/undoRecordUpdate', 'localMemories/updateRecord',
    'skillManager/create', 'skillManager/importDirectory', 'skillManager/trashPersonalSkill',
    'workbench/desktop', 'workbench/cancelImport', 'workbench/importData', 'workbench/importStatus', 'workbench/inspectImport',
  ],
  'runs code or a shell outside the agent': [
    'dynamicCordisRunner/getClientCode', 'dynamicCordisRunner/inventory', 'dynamicCordisRunner/invoke',
    'dynamicCordisRunner/reportClientGuardFailure', 'dynamicCordisRunner/reportRenderFailure', 'dynamicCordisRunner/resolveInspectQuery',
    'dynamicCordisRunner/resolveRequestRun', 'dynamicCordisRunner/runHostHalf', 'dynamicCordisRunner/settleUserRun',
    'dynamicCordisRunner/stopFromPanel', 'dynamicCordisRunner/syncInspectManifest', 'dynamicCordisRunner/undefineFromPanel',
    'terminal/attach', 'terminal/close', 'terminal/create', 'terminal/environment', 'terminal/list', 'terminal/rename',
    'terminal/retain', 'terminal/shells',
  ],
  'belongs to remote access itself': [
    'remoteAccess/follow',
    'remoteDevices/cancelInvite', 'remoteDevices/createInvite', 'remoteDevices/decide', 'remoteDevices/revoke', 'remoteDevices/status',
  ],
}

const ENDPOINT = /^[A-Za-z0-9_$.-]+(?:\/[A-Za-z0-9_$.-]+)*$/

/** Whether a device may call or open this Gateway endpoint. */
export function allowsEndpoint(endpoint: string): boolean {
  return ALLOWED_ENDPOINTS.has(endpoint)
}

/** Whether a device may send this request to `/api`; `pathname` includes the `/api` prefix. */
export function allowsApiRequest(method: string, pathname: string): boolean {
  const route = ALLOWED_ROUTES.get(pathname)
  if (route !== undefined) return route.includes(method)
  const endpoint = pathname.slice('/api/'.length)
  return method === 'POST' && pathname.startsWith('/api/') && ENDPOINT.test(endpoint) && ALLOWED_ENDPOINTS.has(endpoint)
}

/**
 * Whether a device may make this RPC call that {@link allowsApiRequest} refuses,
 * judged by its arguments (`payload.args` of the request body).
 */
export function allowsApiCall(method: string, pathname: string, args: unknown): boolean {
  const allows = pathname.startsWith('/api/') ? ALLOWED_CALLS.get(pathname.slice('/api/'.length)) : undefined
  return method === 'POST' && allows !== undefined && typeof args === 'object' && args !== null && allows(args as Record<string, unknown>)
}

/** Every allowed endpoint, route and argument-checked call, for review and for the coverage test. */
export const allowed = { endpoints: [...ALLOWED_ENDPOINTS].sort(), routes: [...ALLOWED_ROUTES.keys()].sort(), calls: [...ALLOWED_CALLS.keys()].sort() }
