// Keep the product's two optional-mode controls over the pinned official
// controller. Preset definitions, activation and session ownership stay native.
export function adaptNativePresetUI(source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Native preset UI anchor changed: ${before.slice(0, 100)}`)
    source = source.replace(before, after)
  }
  replace('const en = {', 'const en = { productDisabled: "Disabled", productNotReady: "Preset configuration is not ready. Try again.", productApplyFailed: "Could not apply the preset change. Try again or restart the app.",')
  replace('const zh = {', 'const zh = { productDisabled: "已关闭", productNotReady: "预设配置未就绪，请重试", productApplyFailed: "预设变更未生效，请重试或重新启动应用",')
  replace('"remote.agentPresets",', '"remote.agentPresets",\n"remote.pluginManager",')
  replace('makeDefault, setPickerVisible, startCreatorDraft', 'makeDefault, setPickerVisible, setOptionalEnabled, startCreatorDraft')
  replace('const creator = startCreatorDraft !== void 0 && state.rows.some((row) => row.id === "cordis")',
    'const creator = startCreatorDraft !== void 0 && state.rows.some((row) => row.id === "cordis" && row.productEnabled !== false)')
  replace('const selectionAction = row.broken !== void 0 ?', 'const selectionAction = row.productEnabled === false ? t("productDisabled") : row.broken !== void 0 ?')
  replace('disabled: row.isDefault || row.broken === void 0 && (!state.showPicker || state.policySaving),',
    'disabled: row.productEnabled === false || row.isDefault || row.broken === void 0 && (!state.showPicker || state.policySaving),')
  replace('children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {',
    `children: [row.productEntry === void 0 ? null : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
      checked: row.productEnabled === true,
      disabled: state.status !== "ready" || state.policySaving,
      label: display.name,
      onChange: enabled => setOptionalEnabled(row.id, enabled)
    }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {`)
  replace('rows: result.value.presets,', `rows: await this.productRows(result.value.presets),`)
  replace('async makeDefault(id, sync) {', `async productRows(presets) {
    const plugins = await this.ctx.remote.pluginManager.listPlugins();
    if (!plugins.ok) throw new Error(plugins.error.message);
    const rows = [...presets];
    for (const id of ["minimal", "cordis"]) {
      const entry = plugins.value.find(row => row.patchId === "preset-" + id);
      if (!entry) throw new Error(this.ctx.locale.bind("settings.agentPreset")("productNotReady"));
      const index = rows.findIndex(row => row.id === id);
      const row = { ...(index < 0 ? { id, isDefault: false, trust: "system", order: id === "minimal" ? 3 : 4 } : rows[index]), productEntry: entry.entryId, productEnabled: entry.enabled };
      if (index < 0) rows.push(row); else rows[index] = row;
    }
    return rows.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  }
  async setOptionalEnabled(id, enabled, sync) {
    await this.policy(async () => {
      const row = this.store.getSnapshot().rows.find(row => row.id === id);
      if (!row?.productEntry) return this.ctx.locale.bind("settings.agentPreset")("productNotReady");
      if (!enabled && row.isDefault) {
        const error = await writeDefaultPreset(this.ctx, "standard");
        if (error !== void 0) return error;
      }
      const result = await this.ctx.remote.pluginManager.setPluginEnabled(row.productEntry, enabled);
      if (!result.ok) return result.error.message;
      if (result.value.application !== "applied") return this.ctx.locale.bind("settings.agentPreset")("productApplyFailed");
    }, sync);
  }
  async makeDefault(id, sync) {`)
  // Slot props are bound to the same native controller as all other actions.
  replace('load: () => section.load(),', 'load: () => section.load(),\nsetOptionalEnabled: (id, enabled) => section.setOptionalEnabled(id, enabled, captureBlankSessionSync()),')
  return source
}
