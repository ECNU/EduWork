window.__ModuleLoader__.load({
	id: "@eduwork/dsh-client-ui-web-search-product",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region lib/types/client/locales.js
		/** Locale bundles for the web-search provider's settings page. */
		/** English copy. */
		const en = {
			title: "Web search",
			description: "Set up the DeepSeek search provider.",
			useSearchApi: "Use the new Web Search API",
			useSearchApiHint: "When off, restore this product's default search and page fetching. For the new Web Search API's features and pricing, see the ",
			searchGuide: "Search & Fetch guide",
			searchGuideUrl: "https://api-docs.deepseek.com/guides/search",
			apiKey: "API key",
			apiKeyHint: "Stored outside the settings file. Leave blank to keep the current key.",
			apiKeySet: "A key is configured.",
			apiKeyUnset: "DeepSeek APIs require an API key; default search follows this product's settings.",
			baseUrl: "Messages API base URL",
			baseUrlHint: "Include the API prefix, such as https://api.deepseek.com/anthropic/v1. The provider appends /messages. Leave blank to restore the default.",
			searchApiBaseUrl: "Search / Fetch API base URL",
			searchApiBaseUrlHint: "Include the API prefix, such as https://api.deepseek.com/v1/tools. The provider appends /search or /fetch. Leave blank to restore the default.",
			maxUses: "Max searches per request",
			maxUsesHint: "How many searches the auxiliary model may run within one Messages request. Applies only to the Messages API.",
			count: "Results per search",
			countHint: "Results returned per query: an integer from 1 to 50, default 10. This controls result count, not search calls. web_search keeps no more sources than its own result limit.",
			overridden: "Overridden",
			reset: "Reset to default",
			readOnly: "This deployment stores settings read-only.",
			unavailable: "This plugin is not loaded, so it cannot be configured right now.",
			save: "Save",
			saving: "Saving…",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			invalidNumber: "Enter a number, or leave blank to use the default.",
			invalidCount: "Enter an integer from 1 to 50, or leave blank to use the default."
		};
		/** Simplified Chinese copy. */
		const zh = {
			title: "网页搜索",
			description: "设置 DeepSeek 的搜索提供方。",
			useSearchApi: "启用新版 Web 搜索 API",
			useSearchApiHint: "关闭时恢复产品默认的搜索与网页读取方式。新版 Web 搜索 API 功能与计费详见",
			searchGuide: "网页搜索与抓取指南",
			searchGuideUrl: "https://api-docs.deepseek.com/zh-cn/guides/search",
			apiKey: "API Key",
			apiKeyHint: "不写入设置文件。留空表示保持当前密钥。",
			apiKeySet: "已配置密钥。",
			apiKeyUnset: "使用 DeepSeek 接口需要配置 API Key；默认搜索按产品设置运行。",
			baseUrl: "Messages API 基础地址",
			baseUrlHint: "填写含 API 前缀的地址，例如 https://api.deepseek.com/anthropic/v1；程序追加 /messages，留空恢复默认。",
			searchApiBaseUrl: "Search / Fetch API 基础地址",
			searchApiBaseUrlHint: "填写含 API 前缀的地址，例如 https://api.deepseek.com/v1/tools；程序追加 /search 或 /fetch，留空恢复默认。",
			maxUses: "单次请求最多搜索次数",
			maxUsesHint: "辅助模型在一次 Messages 请求内最多可执行的搜索次数，仅适用于 Messages API。",
			count: "每次搜索结果数",
			countHint: "每个查询返回的结果条数，须为 1–50 的整数，默认 10；不控制搜索调用次数。web_search 保留的来源数不超过其自身的结果上限。",
			overridden: "已覆盖",
			reset: "恢复默认",
			readOnly: "本部署的设置为只读。",
			unavailable: "该插件当前未加载，暂时无法配置。",
			save: "保存",
			saving: "保存中…",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			invalidNumber: "请填数字；留空表示使用默认值。",
			invalidCount: "请填 1–50 的整数；留空表示使用默认值。"
		};
		/**
		* The form frame's copy, read from this page's dictionary.
		* @param t - the page's locale reader.
		* @returns the labels the shared settings form renders.
		*/
		function formLabels(t) {
			return {
				unavailable: t("unavailable"),
				readOnly: t("readOnly"),
				saveFailed: t("saveFailed"),
				save: t("save"),
				saving: t("saving")
			};
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-settings-web-search/src/client/WebSearchCard.module.css.mjs
		const css = ".ebPkbG_feature{gap:6px;display:grid}.ebPkbG_toggleRow{color:var(--dsw-alias-label-primary);justify-content:space-between;align-items:flex-start;gap:16px;font-size:13px;line-height:1.5;display:flex}.ebPkbG_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.ebPkbG_link{color:var(--dsw-alias-link);text-decoration:none}.ebPkbG_link:hover{text-decoration:underline}";
		const tagId = "@eduwork/dsh-client-ui-web-search-product/WebSearchCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@eduwork/dsh-client-ui-web-search-product";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var WebSearchCard_module_css_default = {
			"feature": "ebPkbG_feature",
			"hint": "ebPkbG_hint",
			"link": "ebPkbG_link",
			"toggleRow": "ebPkbG_toggleRow"
		};
		//#endregion
		//#region lib/types/client/WebSearchCard.js
		/**
		* Render the web-search provider's one-liner or its settings form, as the Plugins page asks.
		* @param props - the view asked for, locale copy, the form snapshot, and its actions.
		* @returns the one-liner, or the form.
		*/
		function WebSearchCard(props) {
			const { t } = props;
			const state = props.useWebSearchCard((snapshot) => snapshot);
			if (props.view === "summary") return t("description");
			const disabled = !state.writable || state.saving;
			const searchApi = state.useSearchApi;
			const limitField = searchApi ? "count" : "maxUses";
			return (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.SettingsForm, {
				labels: formLabels(t),
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					state.apiSwitchAvailable && (0, react_jsx_runtime.jsxs)("div", {
						className: WebSearchCard_module_css_default.feature,
						children: [(0, react_jsx_runtime.jsxs)("label", {
							className: WebSearchCard_module_css_default.toggleRow,
							children: [(0, react_jsx_runtime.jsx)("span", { children: t("useSearchApi") }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
								checked: searchApi,
								label: t("useSearchApi"),
								disabled: disabled || state.apiSwitchBlocked,
								onChange: (checked) => {
									props.setSearchApi(checked);
								}
							})]
						}), (0, react_jsx_runtime.jsxs)("p", {
							className: WebSearchCard_module_css_default.hint,
							children: [t("useSearchApiHint"), (0, react_jsx_runtime.jsx)("a", {
								className: WebSearchCard_module_css_default.link,
								href: t("searchGuideUrl"),
								target: "_blank",
								rel: "noopener noreferrer",
								children: t("searchGuide")
							})]
						})]
					}),
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsSecretField, {
						id: "plugin-config-web-search-key",
						label: t("apiKey"),
						hint: t("apiKeyHint"),
						disabled: !state.apiKeyWritable,
						text: state.apiKey.text,
						configured: state.apiKeyConfigured,
						stateLabel: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"),
						onEdit: (text) => {
							props.edit("apiKey", text);
						}
					}),
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
						id: "plugin-config-web-search-endpoint",
						label: t(searchApi ? "searchApiBaseUrl" : "baseUrl"),
						hint: t(searchApi ? "searchApiBaseUrlHint" : "baseUrlHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						disabled,
						...state.baseURL,
						onEdit: (text) => {
							props.edit("baseURL", text);
						},
						onReset: () => {
							props.resetField("baseURL");
						}
					}),
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
						id: searchApi ? "plugin-config-web-search-count" : "plugin-config-web-search-max-uses",
						label: t(limitField),
						hint: t(searchApi ? "countHint" : "maxUsesHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t(searchApi ? "invalidCount" : "invalidNumber"),
						numeric: true,
						disabled,
						...state[limitField],
						onEdit: (text) => {
							props.edit(limitField, text);
						},
						onReset: () => {
							props.resetField(limitField);
						}
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/web-search-card-controller.js
		/**
		* The web-search page's staged form over three settings namespaces: `web`,
		* whose provider selection the Search API switch writes, `web-search-deepseek`
		* for Messages search, and `web-deepseek-api` for the Search and Fetch APIs.
		*
		* The switch selects `deepseek-search-api` and `deepseek-fetch-api` together, or
		* Messages search with local HTTP fetch. A selection equal to the deployment's
		* composed value clears the override instead of storing a copy of it.
		*
		* The key is the one control that does not live in a section: its literal
		* never rides a response, so the page learns only whether one is configured
		* and writes it through the credentials domain, addressed by the reference the
		* selected API's section names. It is still staged with the rest of the form,
		* so one save covers everything the page shows.
		*/
		/**
		* Namespaces this page edits. Spelled here rather than imported: a client
		* package must not depend on a Host package.
		*/
		const WEB_SEARCH_NS = "web-search-deepseek";
		/** Namespace of the DeepSeek Search and Fetch API providers. */
		const WEB_API_NS = "web-deepseek-api";
		/** Provider ids the switch writes into the web service's selection. */
		const PROVIDERS = {
			searchProvider: {
				api: "deepseek-search-api",
				messages: "deepseek-official"
			},
			fetchProvider: {
				api: "deepseek-fetch-api",
				messages: "http"
			}
		};
		/** Credential reference the providers resolve when a section names none. */
		const DEFAULT_API_KEY_REF = "DEEPSEEK_API_KEY";
		/** Form field the credential control stages under. */
		const API_KEY_FIELD = "apiKey";
		/** Bridges the three settings scopes and the credentials domain onto the page. */
		var WebSearchCardController = class {
			scopes;
			ctx;
			selection;
			messages;
			api;
			store;
			unsubscribe;
			credential = {
				ref: "",
				configured: false,
				writable: true
			};
			/**
			* @param scopes - the bound settings scopes for the page's namespaces.
			* @param ctx - the page plugin's context, whose `remote.credentials` namespace
			* answers for the credential the selected section references.
			*/
			constructor(scopes, ctx) {
				this.scopes = scopes;
				this.ctx = ctx;
				this.selection = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scopes.web, [(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("searchProvider"), (0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("fetchProvider")], [{
					field: API_KEY_FIELD,
					write: (text) => this.writeKey(text)
				}]);
				this.messages = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scopes.messages, [(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("baseURL"), (0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("maxUses")]);
				this.api = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scopes.api, [(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("baseURL"), {
					...(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("count"),
					parse: (text) => {
						if (text.trim() === "") return { kind: "clear" };
						const value = Number(text);
						return Number.isInteger(value) && value >= 1 && value <= 50 ? {
							kind: "set",
							value
						} : void 0;
					}
				}]);
				this.store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(this.projection());
				const publish = () => {
					this.store.set(this.projection());
					if (this.ref() !== this.credential.ref) this.readCredential();
				};
				this.unsubscribe = [...[
					this.selection,
					this.messages,
					this.api
				].map((form) => form.bind(() => form.shell()).subscribe(publish)), ...[
					scopes.web,
					scopes.messages,
					scopes.api
				].map((scope) => scope.subscribe(() => {
					this.readCredential();
				}))];
				this.readCredential();
			}
			/** Whether the Host serves both sections the switch needs. */
			switchAvailable() {
				return this.selection.shell().available && this.api.shell().available;
			}
			/** The staged switch position, read from the staged search selection. */
			searchApi() {
				return this.switchAvailable() && this.selection.field("searchProvider").text === PROVIDERS.searchProvider.api;
			}
			projection() {
				const primary = this.messages.shell();
				const served = [
					primary,
					this.selection.shell(),
					this.api.shell()
				].filter((item) => item.available);
				const shell = {
					available: primary.available,
					writable: served.every((item) => item.writable),
					dirty: served.some((item) => item.dirty),
					invalid: served.some((item) => item.invalid),
					saving: served.some((item) => item.saving),
					failed: served.some((item) => item.failed)
				};
				const searchApi = this.searchApi();
				return {
					...shell,
					apiSwitchAvailable: this.switchAvailable(),
					apiSwitchBlocked: shell.invalid || shell.failed,
					useSearchApi: searchApi,
					baseURL: (searchApi ? this.api : this.messages).field("baseURL"),
					maxUses: this.messages.field("maxUses"),
					count: this.api.field("count"),
					apiKey: this.selection.field(API_KEY_FIELD),
					apiKeyConfigured: this.credential.configured,
					apiKeyWritable: this.credential.writable
				};
			}
			/** The reference the selected API's section names, or the providers' default. */
			ref() {
				return refOf(this.searchApi() ? this.scopes.api.getSnapshot() : this.scopes.messages.getSnapshot());
			}
			/**
			* Ask the credentials domain about the reference the selected section currently names.
			*
			* The answer is stored with the reference it describes: `apiKeyEnv` and the
			* switch can change between the request and its response, and two reads can
			* settle out of order, so a response is published only while it still
			* answers for the reference in force.
			*/
			async readCredential() {
				const ref = this.ref();
				if (ref !== this.credential.ref) {
					this.credential = {
						ref,
						configured: false,
						writable: true
					};
					this.store.set(this.projection());
				}
				const response = await this.ctx.remote.credentials.describe([ref]);
				if (!response.ok || ref !== this.ref()) return;
				const view = response.value[ref];
				const next = {
					ref,
					configured: view?.configured ?? false,
					writable: view?.writable ?? true
				};
				if (next.configured === this.credential.configured && next.writable === this.credential.writable) return;
				this.credential = next;
				this.store.set(this.projection());
			}
			/**
			* Re-read after the Host reports a change to the reference this page watches.
			*
			* A key can be written from somewhere else — the Models page addresses the
			* same reference — and no settings section changes when it is, so without
			* this the badge keeps reporting a state the Host already replaced.
			* @param ref - the reference the Host reports as changed.
			*/
			refreshCredential(ref) {
				if (ref !== this.credential.ref) return;
				this.readCredential();
			}
			/**
			* Build the face the page's slot registration injects. `baseURL` edits the
			* selected API's endpoint; `maxUses` and `count` edit their own sections.
			* @returns the page's snapshot and its form actions.
			*/
			inject() {
				const formOf = (field) => {
					if (field === API_KEY_FIELD) return this.selection;
					if (field === "maxUses") return this.messages;
					if (field === "count") return this.api;
					return this.searchApi() ? this.api : this.messages;
				};
				return {
					hooks: { webSearchCard: this.store },
					edit: (field, text) => {
						formOf(field).actions().edit(field, text);
					},
					resetField: (field) => {
						formOf(field).actions().resetField(field);
					},
					setSearchApi: (enabled) => {
						this.select(enabled);
					},
					save: () => {
						this.save();
					},
					discard: () => {
						for (const form of [
							this.selection,
							this.messages,
							this.api
						]) form.actions().discard();
					}
				};
			}
			/**
			* Stage both provider selections for one switch position. A target equal to
			* the composed value clears the override so the deployment default keeps
			* applying.
			* @param enabled - true for the Search and Fetch APIs.
			*/
			select(enabled) {
				const base = this.scopes.web.getSnapshot().base;
				const actions = this.selection.actions();
				for (const field of ["searchProvider", "fetchProvider"]) {
					const target = enabled ? PROVIDERS[field].api : (base?.[field] && base[field] !== PROVIDERS[field].api ? base[field] : PROVIDERS[field].messages);
					if (base?.[field] === target) actions.resetField(field);
					else actions.edit(field, target);
				}
			}
			/**
			* Save the provider sections before the selection, so a switch takes effect
			* only after the endpoint it uses has landed. A refused section stops the
			* selection from saving and keeps every remaining draft for correction.
			* @returns settlement after every attempted write.
			*/
			async save() {
				const state = this.projection();
				if (!state.available || state.invalid || state.saving) return;
				for (const form of [this.messages, this.api]) {
					if (!form.shell().available || !form.shell().dirty) continue;
					await form.save();
					if (form.shell().failed) return;
				}
				if (this.selection.shell().dirty) await this.selection.save();
			}
			/**
			* Write the staged key, then re-read whether the Host now holds one.
			* @param value - the staged credential literal.
			* @returns whether the Host reports a configured credential afterwards.
			*/
			async writeKey(value) {
				await this.ctx.remote.credentials.set(this.ref(), value);
				await this.readCredential();
				return this.credential.configured;
			}
			/** Release configuration subscriptions. */
			dispose() {
				for (const off of this.unsubscribe) off();
				for (const form of [
					this.selection,
					this.messages,
					this.api
				]) form.dispose();
			}
		};
		/**
		* The credential reference a section names, or the providers' default.
		* @param snapshot - the section's current scope snapshot.
		* @returns the reference to address.
		*/
		function refOf(snapshot) {
			const declared = snapshot.value?.apiKeyEnv;
			return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_API_KEY_REF;
		}
		//#endregion
		//#region lib/types/client/index.js
		/**
		* The web-search settings page, browser half: the switch between DeepSeek
		* Messages search and the Search and Fetch APIs, which writes the `web`
		* provider selection, and the selected API's key, endpoint, and per-search
		* limit over the `web-search-deepseek` or `web-deepseek-api` namespace. The
		* page registers into the Plugins page's `plugins.item` slot while the Host
		* serves `web-search-deepseek`, so a deployment without that provider shows no
		* trace of it; the switch appears only while the Host also serves `web` and
		* `web-deepseek-api`.
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.webSearch";
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.credentials",
			"configForms"
		];
		/**
		* Mount the web-search settings page while the Host serves its namespace.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-settings-web-search: dictionaries");
			const card = new WebSearchCardController({
				web: ctx.configForms.get("web"),
				messages: ctx.configForms.get(WEB_SEARCH_NS),
				api: ctx.configForms.get(WEB_API_NS)
			}, ctx);
			ctx.effect(() => () => {
				card.dispose();
			}, "ui-settings-web-search: form subscription");
			ctx.effect(() => ctx.remote.$on("credentials/reference-updated", (ref) => {
				card.refreshCredential(ref);
			}), "ui-settings-web-search: credential invalidations");
			ctx.effect(() => ctx.configForms.whileServed([WEB_SEARCH_NS], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
				name: "plugins.item",
				id: "web-search",
				order: 20,
				label: () => t("title"),
				locale: NS,
				inject: () => card.inject()
			}, WebSearchCard))), "ui-settings-web-search: page");
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map