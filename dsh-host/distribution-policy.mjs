// Applied through runProfile.patchFiles AFTER profile/home preferences, on
// initial boot and official profile reload. Model request headers are unchanged.
export const disabledDistributionEntries = Object.freeze([
  'session-telemetry-otel', 'session-log-deepseek',
  'plugin-package-inventory-deepseek', 'desktop-product-telemetry', 'product-analytics',
  'ui-message-feedback', 'message-feedback', 'command-feedback', 'ui-settings-session-log',
  'deepseek-account', 'account-controller', 'ui-settings-account', 'ui-account-notifications',
  'eduwork-native-reveal',
  // rc.2's Web bundle now contributes Office skills and a primary-runtime
  // dependency loader globally. The product already supplies the Office
  // catalog (including user switches) and its own verified Python runtime.
  // Keep the native office-kit service/tools; avoid a second skill catalog
  // and a loader pointing at a DSH primary-runtime layout we do not ship.
  'skill-office', 'workspace-dependencies',
])

export const distributionPolicy = () => disabledDistributionEntries.map(id => ({ id, disabled: true }))
