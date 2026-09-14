import {
  accountResult, baseURLSchema, beginResult, configurationResult, configurationTargetSchema, openConfigurationResult, jsonParameter, managementResult, loginIdSchema, loginResult,
  modelCatalogModeSchema, profileIdSchema, reconcileOptionsSchema, restartResult, runtimeModelsSchema, resourcesResult, enterpriseSelectionResult, enterpriseSelectionOptionsSchema,
} from './typert-schemas.js'

const pkg = '@eduwork/dsh-oidc'
const source = { file: 'lib/index.js', line: 1, column: 1 }
const profile = () => jsonParameter('profileID', profileIdSchema, `${pkg}#ProfileID`)
const login = () => jsonParameter('loginID', loginIdSchema, `${pkg}#LoginID`)
const options = () => jsonParameter('options', reconcileOptionsSchema, `${pkg}#ReconcileOptions`)
const baseURL = () => jsonParameter('baseURL', baseURLSchema, `${pkg}#BaseURL`)
const modelMode = () => jsonParameter('modelMode', modelCatalogModeSchema, `${pkg}#ModelCatalogMode`)
const models = () => jsonParameter('models', runtimeModelsSchema, `${pkg}#RuntimeModels`)
const descriptor = (method, parameters, result) => ({
  id: `${pkg}#oidcAccounts/${method}`, service: 'oidcAccounts', namespace: 'oidcAccounts', method,
  invocation: { kind: 'direct' }, parameters, result, sourceLocation: source,
})

export const TYPERT_REMOTE = {
  package: pkg,
  descriptors: [
    descriptor('configuration', [], configurationResult),
    descriptor('openConfiguration', [jsonParameter('target', configurationTargetSchema, `${pkg}#ConfigurationTarget`)], openConfigurationResult),
    descriptor('status', [profile()], accountResult),
    descriptor('resources', [profile()], resourcesResult),
    descriptor('begin', [profile()], beginResult),
    descriptor('loginStatus', [login()], loginResult),
    descriptor('cancelLogin', [login()], loginResult),
    descriptor('reconcile', [profile(), options()], accountResult),
    descriptor('selectEnterpriseModel', [profile(), jsonParameter('options', enterpriseSelectionOptionsSchema, `${pkg}#EnterpriseSelectionOptions`)], enterpriseSelectionResult),
    descriptor('logout', [profile()], accountResult),
    descriptor('management', [], managementResult),
    descriptor('activate', [profile()], managementResult),
    descriptor('configure', [profile()], managementResult),
    descriptor('addCustom', [baseURL()], managementResult),
    descriptor('updateCustom', [profile(), baseURL()], managementResult),
    descriptor('removeProfile', [profile()], managementResult),
    descriptor('configureModels', [profile(), modelMode(), models()], managementResult),
    descriptor('restart', [], restartResult),
  ],
}

export default TYPERT_REMOTE
