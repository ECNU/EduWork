// Applied through runProfile.patchFiles AFTER profile/home preferences, on
// initial boot and official profile reload. Model request headers are unchanged.
export const disabledDistributionEntries = Object.freeze([
  'session-telemetry-otel', 'session-log-deepseek',
  'plugin-package-inventory-deepseek', 'desktop-product-telemetry', 'product-analytics',
  'ui-message-feedback', 'message-feedback', 'command-feedback', 'ui-settings-session-log',
  'deepseek-account', 'account-controller', 'ui-settings-account',
  'eduwork-native-reveal',
])

export const distributionPolicy = () => disabledDistributionEntries.map(id => ({ id, disabled: true }))
