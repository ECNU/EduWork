declare module '@joplin/turndown-plugin-gfm' {
  type GfmPlugin = (service: TurndownService) => void
  const gfm: GfmPlugin
  const tables: GfmPlugin
  const strikethrough: GfmPlugin
  const taskListItems: GfmPlugin
  const highlightedCodeBlock: GfmPlugin
  export { gfm, tables, strikethrough, taskListItems, highlightedCodeBlock }
}
