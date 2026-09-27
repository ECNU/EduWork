window.__ModuleLoader__.load({
	id: "@eduwork/client-ui-browser",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:packages/extensions/eduwork-client-ui-browser/src/client/panel.module.css.mjs
		const css = ".oWvewq_panel{height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);flex-direction:column;display:flex}.oWvewq_toolbar{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:8px 10px;display:flex}.oWvewq_navigation{flex-shrink:0;align-items:center;gap:2px;display:flex}.oWvewq_iconButton{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;flex-shrink:0;justify-content:center;align-items:center;padding:0;display:inline-flex}.oWvewq_iconButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}.oWvewq_iconButton:disabled{opacity:.35;cursor:default}.oWvewq_iconButton:focus-visible,.oWvewq_address:focus-within{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.oWvewq_address{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:8px;flex:1;align-items:center;gap:6px;min-width:0;height:32px;padding:0 4px 0 9px;display:flex}.oWvewq_addressIcon{color:var(--dsw-alias-label-secondary);display:flex}.oWvewq_address input{width:100%;min-width:0;color:inherit;font:inherit;background:0 0;border:0;outline:0;font-size:12px}.oWvewq_address input::placeholder{color:var(--dsw-alias-label-secondary)}.oWvewq_progress{background:0 0;flex-shrink:0;height:2px}.oWvewq_progress[data-loading]{background:var(--dsw-alias-brand-primary);animation:1s ease-in-out infinite alternate oWvewq_loading}@keyframes oWvewq_loading{to{opacity:.3}}@media (prefers-reduced-motion:reduce){.oWvewq_progress[data-loading]{animation:none}}.oWvewq_viewport{flex:1;min-height:0;position:relative}.oWvewq_empty{box-sizing:border-box;text-align:center;height:100%;color:var(--dsw-alias-label-secondary);flex-direction:column;justify-content:center;align-items:center;gap:12px;padding:28px;display:flex}.oWvewq_empty>svg{opacity:.65;width:32px;height:32px}.oWvewq_empty strong{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500}.oWvewq_empty p{max-width:240px;margin:0;font-size:12px;line-height:1.7}.oWvewq_error{color:var(--dsw-alias-state-error-primary);padding:8px 12px;font-size:12px}";
		const tagId = "@eduwork/client-ui-browser/panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@eduwork/client-ui-browser";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var panel_module_css_default = {
			"address": "oWvewq_address",
			"addressIcon": "oWvewq_addressIcon",
			"empty": "oWvewq_empty",
			"error": "oWvewq_error",
			"iconButton": "oWvewq_iconButton",
			"loading": "oWvewq_loading",
			"navigation": "oWvewq_navigation",
			"panel": "oWvewq_panel",
			"progress": "oWvewq_progress",
			"toolbar": "oWvewq_toolbar",
			"viewport": "oWvewq_viewport"
		};
		//#endregion
		//#region src/client/panel.tsx
		const inject = [
			"slots",
			"sidebarRight",
			"sidebarRightTabs",
			"sessions"
		];
		const bridge = () => window.eduworkBrowserPanel;
		const labels = navigator.language.toLowerCase().startsWith("zh") ? {
			browser: "浏览器",
			description: "查看当前会话正在浏览的网页",
			back: "后退",
			forward: "前进",
			reload: "刷新",
			stop: "停止加载",
			external: "在外部浏览器打开",
			address: "输入网址",
			open: "访问",
			empty: "在当前会话中浏览网页",
			hint: "输入网址开始浏览，或让 AI 打开网页后显示在这里。",
			failed: "网页操作失败，请重试。"
		} : {
			browser: "Browser",
			description: "Browse pages in this conversation",
			back: "Back",
			forward: "Forward",
			reload: "Reload",
			stop: "Stop loading",
			external: "Open in external browser",
			address: "Enter a web address",
			open: "Go",
			empty: "Browse in this conversation",
			hint: "Enter a URL, or ask the assistant to open and show a page.",
			failed: "Could not complete the browser action. Please retry."
		};
		function Icon({ name }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "18",
				height: "18",
				viewBox: "0 0 20 20",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: {
					external: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M11 3h6v6M17 3l-9 9M8 4H4v13h13v-4" }),
					back: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m10 4-6 6 6 6M4 10h13" }),
					forward: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m10 4 6 6-6 6M16 10H3" }),
					reload: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M16 7a6.5 6.5 0 1 0 .2 6M16 3v4h-4" }) }),
					stop: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m5 5 10 10M15 5 5 15" }),
					globe: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "10",
							cy: "10",
							r: "7.5"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
							cx: "10",
							cy: "10",
							rx: "3",
							ry: "7.5"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 7h14M3 13h14" })
					] }),
					open: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 10h13m-5-5 5 5-5 5" })
				}[name]
			});
		}
		var BrowserStore = class {
			pages = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			tabs = /* @__PURE__ */ new Map();
			bindTab(owner, signal, api) {
				if (signal.aborted || this.tabs.has(signal)) return;
				const close = () => {
					this.tabs.delete(signal);
					if (![...this.tabs.values()].some((tab) => tab.owner === owner)) api.command({
						action: "close",
						owner
					}).catch(() => {});
				};
				this.tabs.set(signal, {
					owner,
					close
				});
				signal.addEventListener("abort", close, { once: true });
			}
			dispose() {
				for (const [signal, tab] of this.tabs) signal.removeEventListener("abort", tab.close);
				this.tabs.clear();
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			read = (owner) => this.pages.get(owner) ?? null;
			update(owner, state) {
				this.pages.set(owner, state);
				for (const listener of this.listeners) listener();
			}
		};
		function BrowserPane({ sessionId: owner, store, api, useTabInfo }) {
			const { tab } = useTabInfo();
			const state = (0, react.useSyncExternalStore)(store.subscribe, () => store.read(owner), () => null);
			const hadPage = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (state) hadPage.current = true;
				else if (hadPage.current) {
					hadPage.current = false;
					tab.actions.close();
				}
			}, [state, tab.actions]);
			const host = (0, react.useRef)(null);
			const [address, setAddress] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			const editing = (0, react.useRef)(false);
			const lease = (0, react.useRef)(crypto.randomUUID());
			const request = (action, args = {}) => api.command({
				owner,
				action,
				...args
			});
			(0, react.useEffect)(() => {
				if (!editing.current) setAddress(state?.url === "about:blank" ? "" : state?.url ?? "");
			}, [state?.url]);
			(0, react.useEffect)(() => {
				let stopped = false;
				request("state").then((value) => {
					if (!stopped) store.update(owner, value);
				}).catch(() => {
					if (!stopped) setError(labels.failed);
				});
				return () => {
					stopped = true;
				};
			}, [
				owner,
				api,
				store
			]);
			(0, react.useEffect)(() => {
				store.bindTab(owner, tab.signal, api);
			}, [
				owner,
				api,
				store,
				tab.signal
			]);
			(0, react.useEffect)(() => {
				const el = host.current;
				if (!el || !tab.visible || !state || tab.signal.aborted) return;
				let frame = 0, previous = "", closed = false;
				const hide = () => {
					request("hide", { lease: lease.current }).catch(() => {});
				};
				const update = () => {
					if (closed) return;
					const modal = [...document.querySelectorAll("[role=\"dialog\"],[role=\"alertdialog\"],[aria-modal=\"true\"],[role=\"menu\"],[role=\"listbox\"]")].some((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
					const rect = el.getBoundingClientRect();
					const bounds = {
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height
					};
					const next = modal ? "hidden" : JSON.stringify(bounds);
					if (next !== previous) {
						previous = next;
						if (modal) hide();
						else request("bounds", {
							bounds,
							lease: lease.current
						}).catch(() => {
							if (!closed) setError(labels.failed);
						});
					}
					frame = requestAnimationFrame(update);
				};
				const release = () => {
					closed = true;
					cancelAnimationFrame(frame);
					hide();
				};
				tab.signal.addEventListener("abort", release, { once: true });
				update();
				return () => {
					tab.signal.removeEventListener("abort", release);
					release();
				};
			}, [
				owner,
				api,
				tab.id,
				tab.visible,
				tab.signal,
				Boolean(state)
			]);
			const act = async (action, args = {}) => {
				try {
					setError("");
					await request(action, args);
				} catch {
					setError(labels.failed);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: panel_module_css_default.panel,
				"aria-label": labels.browser,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: panel_module_css_default.toolbar,
						onSubmit: (event) => {
							event.preventDefault();
							editing.current = false;
							const value = address.trim();
							if (value) act(state ? "navigate" : "open", { url: /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : "https://" + value });
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: panel_module_css_default.navigation,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: panel_module_css_default.iconButton,
										title: labels.back,
										"aria-label": labels.back,
										disabled: !state?.back,
										onClick: () => act("back"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "back" })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: panel_module_css_default.iconButton,
										title: labels.forward,
										"aria-label": labels.forward,
										disabled: !state?.forward,
										onClick: () => act("forward"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "forward" })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: panel_module_css_default.iconButton,
										title: state?.loading ? labels.stop : labels.reload,
										"aria-label": state?.loading ? labels.stop : labels.reload,
										disabled: !state,
										onClick: () => act(state?.loading ? "stop" : "reload"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: state?.loading ? "stop" : "reload" })
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: panel_module_css_default.address,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: panel_module_css_default.addressIcon,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "globe" })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										"aria-label": labels.address,
										placeholder: labels.address,
										value: address,
										spellCheck: false,
										autoComplete: "off",
										onFocus: () => {
											editing.current = true;
										},
										onBlur: () => {
											editing.current = false;
										},
										onChange: (event) => setAddress(event.target.value)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "submit",
										className: panel_module_css_default.iconButton,
										title: labels.open,
										"aria-label": labels.open,
										disabled: !address.trim(),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "open" })
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: panel_module_css_default.iconButton,
								title: labels.external,
								"aria-label": labels.external,
								disabled: !state || !/^https?:/i.test(state.url),
								onClick: () => act("external"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "external" })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.progress,
						"data-loading": state?.loading || void 0
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						role: "alert",
						className: panel_module_css_default.error,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						ref: host,
						className: panel_module_css_default.viewport,
						children: !state && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: panel_module_css_default.empty,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "globe" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: labels.empty }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: labels.hint })
							]
						})
					})
				]
			});
		}
		async function apply(ctx) {
			const api = bridge();
			if (!api) return;
			try {
				if (!(await api.command({ action: "capabilities" }))?.embeddedBrowser) return;
			} catch {
				return;
			}
			const store = new BrowserStore(), seen = /* @__PURE__ */ new Map();
			let current = null, disposed = false;
			const reveal = (owner, state) => {
				if (disposed || owner !== current || !state?.revision || state.revision <= (seen.get(owner) ?? 0)) return;
				try {
					ctx.sidebarRight.openTab("eduwork-browser");
					seen.set(owner, state.revision);
				} catch {}
			};
			const receive = ({ owner, state }) => {
				store.update(owner, state);
				reveal(owner, state);
			};
			const select = () => {
				const owner = ctx.sessions.list.getSnapshot().current ?? null;
				if (owner === current) {
					if (owner) reveal(owner, store.read(owner));
					return;
				}
				current = owner;
				api.command({
					action: "select",
					owner
				}).then((state) => {
					if (!disposed && current === owner && owner) receive({
						owner,
						state
					});
				}).catch(() => {});
			};
			const disposers = [
				ctx.sidebarRightTabs.register({
					id: "@eduwork/client-ui-browser",
					kind: "eduwork-browser",
					title: () => labels.browser,
					guide: [{
						order: 40,
						title: () => labels.browser,
						description: () => labels.description
					}]
				}),
				ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
					name: "sidebar.right.pane.tab",
					key: "@eduwork/client-ui-browser",
					inject: () => ({
						store,
						api
					})
				}, BrowserPane)),
				api.subscribe(receive),
				ctx.sessions.list.subscribe(select)
			];
			select();
			ctx.effect(() => () => {
				disposed = true;
				store.dispose();
				disposers.reverse().forEach((dispose) => dispose());
				api.command({
					action: "select",
					owner: null
				}).catch(() => {});
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
