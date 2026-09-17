window.__ModuleLoader__.load({
	id: "@chatecnu-work/dsh-client-ui-branding",
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
		//#region src/theme.js
		const VISUAL_STYLES = Object.freeze(["dsh", "ecnu-liwa"]);
		function normalizeVisualStyle(value) {
			return VISUAL_STYLES.includes(value) ? value : "ecnu-liwa";
		}
		const pair = (light, dark) => Object.freeze({
			light,
			dark
		});
		const ECNU_LIWA_TOKENS = Object.freeze({
			"--dsw-alias-bg-base": pair("#fffdfb", "#1d1718"),
			"--dsw-alias-bg-layer-1": pair("#fffaf7", "#251d1f"),
			"--dsw-alias-bg-layer-2": pair("#fbf4ef", "#302426"),
			"--dsw-alias-bg-layer-3": pair("#f7ece7", "#3a2a2d"),
			"--dsw-alias-bg-module-platform": pair("#fbf4ef", "#302426"),
			"--dsw-alias-bg-overlay": pair("#fffdfb", "#2a2022"),
			"--dsw-alias-border-l1": pair("#efe3dc", "#49383c"),
			"--dsw-alias-border-l2": pair("#e5d4cc", "#594247"),
			"--dsw-alias-border-l3": pair("#d4bbb3", "#6d5056"),
			"--dsw-alias-brand-primary": pair("#9f2636", "#e57482"),
			"--dsw-alias-brand-primary-new-colorprimary-new-color": pair("#9f2636", "#e57482"),
			"--dsw-alias-brand-primary-invert": pair("#ffffff", "#25181b"),
			"--dsw-alias-brand-text": pair("#8f1f30", "#f18a96"),
			"--dsw-alias-button-info-fill": pair("#a52d3d", "#d85d6c"),
			"--dsw-alias-button-info-hover": pair("#861c2b", "#e57482"),
			"--dsw-alias-button-primary-fill": pair("#9f2636", "#bf4555"),
			"--dsw-alias-button-primary-hover": pair("#861c2b", "#d55a69"),
			"--dsw-alias-button-primary-dimmed": pair("#dfb8bc", "#75414a"),
			"--dsw-alias-interactive-bg-active": pair("#f3dfe0", "#523037"),
			"--dsw-alias-interactive-bg-hover": pair("#f8eeea", "#35272a"),
			"--dsw-alias-interactive-bg-hover-accent": pair("#f5e3e3", "#4a2c32"),
			"--dsw-alias-label-primary": pair("#241a18", "#f7eeee"),
			"--dsw-alias-label-primary-bluish": pair("#8f1f30", "#f18a96"),
			"--dsw-alias-label-secondary": pair("#6f5d57", "#cbbabd"),
			"--dsw-alias-label-tertiary": pair("#99847c", "#a99196"),
			"--dsw-alias-state-business-primary": pair("#9f2636", "#e57482"),
			"--dsw-alias-state-business-tertiary": pair("#f5e3e3", "#4a2c32"),
			"--dsw-alias-markdown-code-block": pair("#f8f1ed", "#241c1e"),
			"--dsw-alias-markdown-inline-code": pair("#f2e4df", "#3a292d"),
			"--dsw-specific-sidebar-fill": pair("#faf3ef", "#21191b"),
			"--dsw-specific-bubble": pair("#fbefee", "#432b30"),
			"--dsw-specific-bubble-highlight": pair("#efd5d7", "#663943"),
			"--dsw-specific-sidebar-nav-item-active-accent": pair("#f3dfe0", "#523037"),
			"--dsw-specific-sidebar-nav-item-active": pair("#f0dfe0", "#492c32"),
			"--dsw-specific-sidebar-nav-item-hover": pair("#f8eeea", "#35272a")
		});
		function tokensForVisualStyle(value) {
			return normalizeVisualStyle(value) === "ecnu-liwa" ? ECNU_LIWA_TOKENS : null;
		}
		Object.freeze({
			blue: null,
			red: ECNU_LIWA_TOKENS
		});
		//#endregion
		//#region src/eduwork-mark.js
		const eduworkMarkPath = "M42 108V81Q42 49 87 39L214 10V28Q214 61 181 70L94 91L174 112V129Q174 151 149 158L94 173L182 195Q214 204 214 235V246L88 219Q63 212 42 195V178Q42 151 75 141L103 133Z";
		//#endregion
		//#region src/identity.js
		const DEFAULT_PRODUCT_NAME = "EduWork";
		function productIdentity(snapshot) {
			const product = snapshot?.base?.product ?? {};
			const name = typeof product.name === "string" && product.name.trim() ? product.name.trim() : DEFAULT_PRODUCT_NAME;
			const candidate = typeof product.logoUrl === "string" ? product.logoUrl.trim() : "";
			const logoUrl = /^(?:https?:\/\/|\/(?!\/)|data:image\/(?:svg\+xml|png|webp|jpeg)(?:;|,))/i.test(candidate) ? candidate : "";
			const label = (key, fallback) => typeof product.styleLabels?.[key] === "string" && product.styleLabels[key].trim() ? product.styleLabels[key].trim() : fallback;
			return {
				name,
				logoUrl,
				styleLabels: {
					dsh: label("dsh", "蓝色"),
					"ecnu-liwa": label("ecnu-liwa", "红色")
				}
			};
		}
		function genericMarkSVG(color) {
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="${/^#[\da-f]{6}$/i.test(color) ? color : "#9f2636"}"/><path d="${eduworkMarkPath}" transform="translate(43 32) scale(.665 .78)" fill="#fff"/></svg>`;
		}
		//#endregion
		//#region src/client/desktop-actions.ts
		const eventName = "eduwork:tray-action";
		const handlers = /* @__PURE__ */ new Map();
		function bindDesktopAction(action, callback) {
			handlers.set(action, callback);
			const drain = () => {
				const pending = window.__eduworkTrayActions ?? [];
				window.__eduworkTrayActions = [];
				for (const value of pending.slice(-8)) {
					const handler = handlers.get(value);
					if (handler) handler();
					else if (value === "new-session" || value === "settings") window.__eduworkTrayActions.push(value);
				}
			};
			window.addEventListener(eventName, drain);
			drain();
			return () => {
				window.removeEventListener(eventName, drain);
				if (handlers.get(action) === callback) handlers.delete(action);
			};
		}
		/** The official settings shell owns its button/open state. This slot retains
		* that owner and invokes its enclosing button, without querying translated UI. */
		function DesktopSettingsTrigger({ wide }) {
			const anchor = (0, react.useRef)(null);
			(0, react.useEffect)(() => bindDesktopAction("settings", () => {
				anchor.current?.closest("button[aria-haspopup=\"dialog\"]")?.click();
			}), []);
			return react.default.createElement(react.default.Fragment, null, react.default.createElement("span", {
				ref: anchor,
				"aria-hidden": true,
				style: {
					fontSize: 18,
					lineHeight: 1
				}
			}, "⚙"), wide && react.default.createElement("span", null, "设置"));
		}
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"slots",
			"theme",
			"connection",
			"remote",
			"settingsScope"
		];
		const h = react.default.createElement;
		const SETTINGS_NAMESPACE = "chatecnu-brand";
		const TOKEN_SOURCE = "@chatecnu-work/dsh-client-ui-branding";
		const choices = Object.freeze([{
			id: "dsh",
			description: "清爽的蓝灰视觉。",
			colors: ["#f6f8fb", "#4d6bfe"]
		}, {
			id: "ecnu-liwa",
			description: "白底、枣红与暖灰视觉。",
			colors: ["#fffaf7", "#9f2636"]
		}]);
		function ProductMark({ size = 22, className, service }) {
			const snapshot = useBrandSnapshot(service);
			const { logoUrl } = productIdentity(snapshot);
			const color = normalizeVisualStyle(snapshot.value?.visualStyle) === "ecnu-liwa" ? "#9f2636" : "#2575ff";
			return h("img", {
				width: size,
				height: size,
				className,
				alt: "",
				"aria-hidden": true,
				src: logoUrl || `data:image/svg+xml,${encodeURIComponent(genericMarkSVG(color))}`,
				style: {
					objectFit: "contain",
					flexShrink: 0
				}
			});
		}
		function useBrandSnapshot(service) {
			return (0, react.useSyncExternalStore)((listener) => service.subscribe(listener), () => service.getSnapshot(), () => service.getSnapshot());
		}
		function VisualStyleRow({ service }) {
			const snapshot = (0, react.useSyncExternalStore)((listener) => service.subscribe(listener), () => service.getSnapshot(), () => service.getSnapshot());
			const selected = normalizeVisualStyle(snapshot.value?.visualStyle);
			const { styleLabels } = productIdentity(snapshot);
			return h("section", { style: {
				padding: "16px 0",
				borderBottom: "1px solid var(--dsw-alias-border-l2)"
			} }, h("div", { style: {
				marginBottom: 8,
				color: "var(--dsw-alias-label-primary)",
				fontSize: 14
			} }, "配色"), h("div", { style: {
				display: "grid",
				gridTemplateColumns: "repeat(2, minmax(180px, 1fr))",
				gap: 8
			} }, ...choices.map((choice) => h("button", {
				key: choice.id,
				type: "button",
				"aria-pressed": selected === choice.id,
				disabled: snapshot.writable !== true,
				onClick: () => {
					service.set("visualStyle", choice.id);
				},
				style: {
					display: "grid",
					gridTemplateColumns: "42px 1fr",
					alignItems: "center",
					gap: 12,
					minHeight: 78,
					padding: "13px 15px",
					borderRadius: 14,
					textAlign: "left",
					cursor: "pointer",
					border: `1px solid ${selected === choice.id ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l2)"}`,
					background: selected === choice.id ? "var(--dsw-alias-bg-module-platform)" : "transparent",
					color: "var(--dsw-alias-label-primary)"
				}
			}, h("span", { style: {
				display: "grid",
				gridTemplateColumns: "1fr 1fr",
				overflow: "hidden",
				width: 40,
				height: 40,
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 10
			} }, ...choice.colors.map((color) => h("span", {
				key: color,
				style: { background: color }
			}))), h("span", null, h("strong", { style: {
				display: "block",
				fontSize: 14,
				lineHeight: 1.5
			} }, styleLabels[choice.id]), h("span", { style: {
				display: "block",
				marginTop: 2,
				color: "var(--dsw-alias-label-secondary)",
				fontSize: 12,
				lineHeight: 1.45
			} }, choice.description))))));
		}
		function ProductBrandName({ service }) {
			return h("span", { style: {
				color: "var(--dsw-alias-label-primary)",
				fontSize: 15,
				fontWeight: 650,
				letterSpacing: "-0.01em",
				whiteSpace: "nowrap"
			} }, productIdentity(useBrandSnapshot(service)).name);
		}
		function installProductIdentity(scope) {
			const previousTitle = document.title;
			const icon = document.createElement("link");
			icon.rel = "icon";
			icon.type = "image/svg+xml";
			icon.dataset.eduworkProductIcon = "true";
			document.head.append(icon);
			let appliedTitle = "";
			const adopt = () => {
				const snapshot = scope.getSnapshot();
				const identity = productIdentity(snapshot);
				const color = normalizeVisualStyle(snapshot.value?.visualStyle) === "ecnu-liwa" ? "#9f2636" : "#2575ff";
				appliedTitle = identity.name;
				document.title = appliedTitle;
				icon.href = identity.logoUrl || `data:image/svg+xml,${encodeURIComponent(genericMarkSVG(color))}`;
				if (identity.logoUrl) icon.removeAttribute("type");
				else icon.type = "image/svg+xml";
			};
			adopt();
			const unsubscribe = scope.subscribe(adopt);
			const observer = new MutationObserver(() => {
				if (!document.title.endsWith(" — DeepSeek Harness")) return;
				const name = productIdentity(scope.getSnapshot()).name;
				appliedTitle = document.title.slice(0, -16) + name;
				if (document.title !== appliedTitle) document.title = appliedTitle;
			});
			observer.observe(document.head, {
				childList: true,
				subtree: true,
				characterData: true
			});
			return () => {
				observer.disconnect();
				unsubscribe();
				if (document.title === appliedTitle) document.title = previousTitle;
				icon.remove();
			};
		}
		function apply(ctx) {
			ctx.inject(["uiWorkspace"], (context) => context.effect(() => bindDesktopAction("new-session", () => context.uiWorkspace.startSession()), "eduwork: tray new session"));
			ctx.slots.inject("settings.trigger", () => ctx.slots.register({
				name: "settings.trigger",
				priority: -100
			}, DesktopSettingsTrigger));
			const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE });
			let clearTokens = () => {};
			const adopt = () => {
				clearTokens();
				clearTokens = () => {};
				const visualStyle = normalizeVisualStyle(scope.getSnapshot().value?.visualStyle);
				document.documentElement.dataset.chatecnuVisualStyle = visualStyle;
				const logoAccent = visualStyle === "ecnu-liwa" ? "#9f2636" : "#2575ff";
				document.documentElement.style.setProperty("--chatecnu-logo-accent", logoAccent);
				const tokens = tokensForVisualStyle(visualStyle);
				if (tokens !== null) clearTokens = ctx.theme.overrideTokens(TOKEN_SOURCE, tokens);
			};
			adopt();
			ctx.effect(() => scope.subscribe(adopt), "chatecnu-work: visual-style adoption");
			ctx.effect(() => () => {
				clearTokens();
				delete document.documentElement.dataset.chatecnuVisualStyle;
				document.documentElement.style.removeProperty("--chatecnu-logo-accent");
			}, "chatecnu-work: visual-style tokens");
			ctx.effect(() => installProductIdentity(scope), "eduwork: document identity");
			ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.inject("sidebar.brand.name", () => ctx.slots.inject("conversation.hero.brand.mark", function* () {
				yield ctx.slots.register({
					name: "sidebar.brand.mark",
					inject: () => ({ service: scope })
				}, ProductMark);
				yield ctx.slots.register({
					name: "sidebar.brand.name",
					inject: () => ({ service: scope })
				}, ProductBrandName);
				yield ctx.slots.register({
					name: "conversation.hero.brand.mark",
					inject: () => ({ service: scope })
				}, ProductMark);
			})));
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "chatecnu-visual-style",
				order: 15,
				inject: () => ({ service: scope })
			}, VisualStyleRow));
		}
		//#endregion
		exports.ProductBrandName = ProductBrandName;
		exports.ProductMark = ProductMark;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
