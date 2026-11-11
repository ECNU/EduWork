export function brandDesktopLocale(value, productName) {
  return { ...value, messages: Object.fromEntries(Object.entries(value.messages)
    .map(([key, message]) => [key, message.replaceAll('DeepSeek Harness', productName)])) }
}
