window.__ModuleLoader__.load({
	id: "@chatecnu-work/dsh-client-ui-media-artifacts",
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
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_dom = require("react-dom");
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/core.js
		var _a$1;
		function $constructor(name, initializer, params) {
			function init(inst, def) {
				if (!inst._zod) Object.defineProperty(inst, "_zod", {
					value: {
						def,
						constr: _,
						traits: /* @__PURE__ */ new Set()
					},
					enumerable: false
				});
				if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				const proto = _.prototype;
				const keys = Object.keys(proto);
				for (let i = 0; i < keys.length; i++) {
					const k = keys[i];
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				var _a;
				const inst = params?.Parent ? new Definition() : this;
				init(inst, def);
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				for (const fn of inst._zod.deferred) fn();
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		function cached(getter) {
			return { get value() {
				{
					const value = getter();
					Object.defineProperty(this, "value", { value });
					return value;
				}
				throw new Error("cached value already set");
			} };
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		function floatSafeRemainder(val, step) {
			const ratio = val / step;
			const roundedRatio = Math.round(ratio);
			const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
			if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
			return ratio - roundedRatio;
		}
		const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
		function defineLazy(object, key, getter) {
			let value = void 0;
			Object.defineProperty(object, key, {
				get() {
					if (value === EVALUATING) return;
					if (value === void 0) {
						value = EVALUATING;
						value = getter();
					}
					return value;
				},
				set(v) {
					Object.defineProperty(object, key, { value: v });
				},
				configurable: true
			});
		}
		function assignProp(target, prop, value) {
			Object.defineProperty(target, prop, {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) Object.assign(mergedDescriptors, Object.getOwnPropertyDescriptors(def));
			return Object.defineProperties({}, mergedDescriptors);
		}
		function esc(str) {
			return JSON.stringify(str);
		}
		function slugify(input) {
			return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		const allowsEval = /* @__PURE__*/ cached(() => {
			if (globalConfig.jitless) return false;
			if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
			try {
				new Function("");
				return true;
			} catch (_) {
				return false;
			}
		});
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		const propertyKeyTypes = /* @__PURE__*/ new Set([
			"string",
			"number",
			"symbol"
		]);
		function escapeRegex(str) {
			return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function clone(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		function optionalKeys(shape) {
			return Object.keys(shape).filter((k) => {
				return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
			});
		}
		const NUMBER_FORMAT_RANGES = {
			safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
			int32: [-2147483648, 2147483647],
			uint32: [0, 4294967295],
			float32: [-34028234663852886e22, 34028234663852886e22],
			float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
		};
		function pick(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = {};
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						newShape[key] = currDef.shape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function omit(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = { ...schema._zod.def.shape };
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						delete newShape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function extend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) {
				const existingShape = schema._zod.def.shape;
				for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
			}
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function safeExtend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function merge(a, b) {
			if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
			return clone(a, mergeDefs(a._zod.def, {
				get shape() {
					const _shape = {
						...a._zod.def.shape,
						...b._zod.def.shape
					};
					assignProp(this, "shape", _shape);
					return _shape;
				},
				get catchall() {
					return b._zod.def.catchall;
				},
				checks: b._zod.def.checks ?? []
			}));
		}
		function partial(Class, schema, mask) {
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const oldShape = schema._zod.def.shape;
					const shape = { ...oldShape };
					if (mask) for (const key in mask) {
						if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						shape[key] = Class ? new Class({
							type: "optional",
							innerType: oldShape[key]
						}) : oldShape[key];
					}
					else for (const key in oldShape) shape[key] = Class ? new Class({
						type: "optional",
						innerType: oldShape[key]
					}) : oldShape[key];
					assignProp(this, "shape", shape);
					return shape;
				},
				checks: []
			}));
		}
		function required(Class, schema, mask) {
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const oldShape = schema._zod.def.shape;
				const shape = { ...oldShape };
				if (mask) for (const key in mask) {
					if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
					if (!mask[key]) continue;
					shape[key] = new Class({
						type: "nonoptional",
						innerType: oldShape[key]
					});
				}
				else for (const key in oldShape) shape[key] = new Class({
					type: "nonoptional",
					innerType: oldShape[key]
				});
				assignProp(this, "shape", shape);
				return shape;
			} }));
		}
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function finalizeIssue(iss, ctx, config) {
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
			rest.path ?? (rest.path = []);
			rest.message = message;
			if (ctx?.reportInput) rest.input = _input;
			return rest;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/errors.js
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			Object.defineProperty(inst, "_zod", {
				value: inst._zod,
				enumerable: false
			});
			Object.defineProperty(inst, "issues", {
				value: def,
				enumerable: false
			});
			inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
			Object.defineProperty(inst, "toString", {
				value: () => inst.message,
				enumerable: false
			});
		};
		const $ZodError = $constructor("$ZodError", initializer$1);
		const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) {
				fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
				fieldErrors[sub.path[0]].push(mapper(sub));
			} else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
							else {
								curr[el] = curr[el] || { _errors: [] };
								curr[el]._errors.push(mapper(issue));
							}
							curr = curr[el];
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/parse.js
		const _parse = (_Err) => (schema, value, _ctx, _params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			if (result.issues.length) {
				const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, _params?.callee);
				throw e;
			}
			return result.value;
		};
		const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			if (result.issues.length) {
				const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, params?.callee);
				throw e;
			}
			return result.value;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? {
				success: false,
				error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? {
				success: false,
				error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
		const _encode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parse(_Err)(schema, value, ctx);
		};
		const _decode = (_Err) => (schema, value, _ctx) => {
			return _parse(_Err)(schema, value, _ctx);
		};
		const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parseAsync(_Err)(schema, value, ctx);
		};
		const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _parseAsync(_Err)(schema, value, _ctx);
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/regexes.js
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const cuid = /^[cC][0-9a-z]{6,}$/;
		const cuid2 = /^[0-9a-z]+$/;
		const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
		const xid = /^[0-9a-vA-V]{20}$/;
		const ksuid = /^[A-Za-z0-9]{27}$/;
		const nanoid = /^[a-zA-Z0-9_-]{21}$/;
		/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
		const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
		/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
		const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
		/** Returns a regex for validating an RFC 9562/4122 UUID.
		*
		* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
		const uuid = (version) => {
			if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
			return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
		};
		/** Practical email validation */
		const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
		const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
		function emoji() {
			return new RegExp(_emoji$1, "u");
		}
		const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
		const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
		const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
		const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
		const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
		const base64url = /^[A-Za-z0-9_-]*$/;
		const httpProtocol = /^https?$/;
		const e164 = /^\+[1-9]\d{6,14}$/;
		const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
		const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
		function timeSource(args) {
			const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
			return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
		}
		function time$1(args) {
			return new RegExp(`^${timeSource(args)}$`);
		}
		function datetime$1(args) {
			const time = timeSource({ precision: args.precision });
			const opts = ["Z"];
			if (args.local) opts.push("");
			if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
			const timeRegex = `${time}(?:${opts.join("|")})`;
			return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
		}
		const string$1 = (params) => {
			const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
			return new RegExp(`^${regex}$`);
		};
		const integer = /^-?\d+$/;
		const number$1 = /^-?\d+(?:\.\d+)?$/;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		const numericOriginMap = {
			number: "number",
			bigint: "bigint",
			object: "date"
		};
		const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
				if (def.value < curr) if (def.inclusive) bag.maximum = def.value;
				else bag.exclusiveMaximum = def.value;
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
				if (def.value > curr) if (def.inclusive) bag.minimum = def.value;
				else bag.exclusiveMinimum = def.value;
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				var _a;
				(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
			});
			inst._zod.check = (payload) => {
				if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
				if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
				payload.issues.push({
					origin: typeof payload.value,
					code: "not_multiple_of",
					divisor: def.value,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
			$ZodCheck.init(inst, def);
			def.format = def.format || "float64";
			const isInt = def.format?.includes("int");
			const origin = isInt ? "int" : "number";
			const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				bag.minimum = minimum;
				bag.maximum = maximum;
				if (isInt) bag.pattern = integer;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (isInt) {
					if (!Number.isInteger(input)) {
						payload.issues.push({
							expected: origin,
							format: def.format,
							code: "invalid_type",
							continue: false,
							input,
							inst
						});
						return;
					}
					if (!Number.isSafeInteger(input)) {
						if (input > 0) payload.issues.push({
							input,
							code: "too_big",
							maximum: Number.MAX_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						else payload.issues.push({
							input,
							code: "too_small",
							minimum: Number.MIN_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						return;
					}
				}
				if (input < minimum) payload.issues.push({
					origin: "number",
					input,
					code: "too_small",
					minimum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
				if (input > maximum) payload.issues.push({
					origin: "number",
					input,
					code: "too_big",
					maximum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
				if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
				if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.minimum = def.length;
				bag.maximum = def.length;
				bag.length = def.length;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				const length = input.length;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
			var _a, _b;
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				if (def.pattern) {
					bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
					bag.patterns.add(def.pattern);
				}
			});
			if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: def.format,
					input: payload.value,
					...def.pattern ? { pattern: def.pattern.toString() } : {},
					inst,
					continue: !def.abort
				});
			});
			else (_b = inst._zod).check ?? (_b.check = () => {});
		});
		const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "regex",
					input: payload.value,
					pattern: def.pattern.toString(),
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
			def.pattern ?? (def.pattern = lowercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
			def.pattern ?? (def.pattern = uppercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
			$ZodCheck.init(inst, def);
			const escapedRegex = escapeRegex(def.includes);
			const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
			def.pattern = pattern;
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.includes(def.includes, def.position)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "includes",
					includes: def.includes,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.startsWith(def.prefix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "starts_with",
					prefix: def.prefix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.endsWith(def.suffix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "ends_with",
					suffix: def.suffix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/doc.js
		var Doc = class {
			constructor(args = []) {
				this.content = [];
				this.indent = 0;
				if (this) this.args = args;
			}
			indented(fn) {
				this.indent += 1;
				fn(this);
				this.indent -= 1;
			}
			write(arg) {
				if (typeof arg === "function") {
					arg(this, { execution: "sync" });
					arg(this, { execution: "async" });
					return;
				}
				const lines = arg.split("\n").filter((x) => x);
				const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
				const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
				for (const line of dedented) this.content.push(line);
			}
			compile() {
				const F = Function;
				const args = this?.args;
				const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
				return new F(...args, lines.join("\n"));
			}
		};
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 4,
			patch: 3
		};
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const checks = [...inst._zod.def.checks ?? []];
			if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
			defineLazy(inst, "~standard", () => ({
				validate: (value) => {
					try {
						const r = safeParse$1(inst, value);
						return r.success ? { value: r.data } : { issues: r.error?.issues };
					} catch (_) {
						return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
					}
				},
				vendor: "zod",
				version: 1
			}));
		});
		const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
			inst._zod.parse = (payload, _) => {
				if (def.coerce) try {
					payload.value = String(payload.value);
				} catch (_) {}
				if (typeof payload.value === "string") return payload;
				payload.issues.push({
					expected: "string",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			$ZodString.init(inst, def);
		});
		const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
			def.pattern ?? (def.pattern = guid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
			if (def.version) {
				const v = {
					v1: 1,
					v2: 2,
					v3: 3,
					v4: 4,
					v5: 5,
					v6: 6,
					v7: 7,
					v8: 8
				}[def.version];
				if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
				def.pattern ?? (def.pattern = uuid(v));
			} else def.pattern ?? (def.pattern = uuid());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
			def.pattern ?? (def.pattern = email);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				try {
					const trimmed = payload.value.trim();
					if (!def.normalize && def.protocol?.source === httpProtocol.source) {
						if (!/^https?:\/\//i.test(trimmed)) {
							payload.issues.push({
								code: "invalid_format",
								format: "url",
								note: "Invalid URL format",
								input: payload.value,
								inst,
								continue: !def.abort
							});
							return;
						}
					}
					const url = new URL(trimmed);
					if (def.hostname) {
						def.hostname.lastIndex = 0;
						if (!def.hostname.test(url.hostname)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid hostname",
							pattern: def.hostname.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.protocol) {
						def.protocol.lastIndex = 0;
						if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid protocol",
							pattern: def.protocol.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.normalize) payload.value = url.href;
					else payload.value = trimmed;
					return;
				} catch (_) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
			def.pattern ?? (def.pattern = emoji());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
			def.pattern ?? (def.pattern = nanoid);
			$ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
			def.pattern ?? (def.pattern = cuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
			def.pattern ?? (def.pattern = cuid2);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
			def.pattern ?? (def.pattern = ulid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
			def.pattern ?? (def.pattern = xid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
			def.pattern ?? (def.pattern = ksuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
			def.pattern ?? (def.pattern = datetime$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
			def.pattern ?? (def.pattern = date$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
			def.pattern ?? (def.pattern = time$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
			def.pattern ?? (def.pattern = duration$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
			def.pattern ?? (def.pattern = ipv4);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv4`;
		});
		const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
			def.pattern ?? (def.pattern = ipv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv6`;
			inst._zod.check = (payload) => {
				try {
					new URL(`http://[${payload.value}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "ipv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv4);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				const parts = payload.value.split("/");
				try {
					if (parts.length !== 2) throw new Error();
					const [address, prefix] = parts;
					if (!prefix) throw new Error();
					const prefixNum = Number(prefix);
					if (`${prefixNum}` !== prefix) throw new Error();
					if (prefixNum < 0 || prefixNum > 128) throw new Error();
					new URL(`http://[${address}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "cidrv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		function isValidBase64(data) {
			if (data === "") return true;
			if (/\s/.test(data)) return false;
			if (data.length % 4 !== 0) return false;
			try {
				atob(data);
				return true;
			} catch {
				return false;
			}
		}
		const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
			def.pattern ?? (def.pattern = base64);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64";
			inst._zod.check = (payload) => {
				if (isValidBase64(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		function isValidBase64URL(data) {
			if (!base64url.test(data)) return false;
			const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
			return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		}
		const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
			def.pattern ?? (def.pattern = base64url);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64url";
			inst._zod.check = (payload) => {
				if (isValidBase64URL(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
			def.pattern ?? (def.pattern = e164);
			$ZodStringFormat.init(inst, def);
		});
		function isValidJWT(token, algorithm = null) {
			try {
				const tokensParts = token.split(".");
				if (tokensParts.length !== 3) return false;
				const [header] = tokensParts;
				if (!header) return false;
				const parsedHeader = JSON.parse(atob(header));
				if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
				if (!parsedHeader.alg) return false;
				if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
				return true;
			} catch {
				return false;
			}
		}
		const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidJWT(payload.value, def.alg)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "jwt",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Number(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
				const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
				payload.issues.push({
					expected: "number",
					code: "invalid_type",
					input,
					inst,
					...received ? { received } : {}
				});
				return payload;
			};
		});
		const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
			$ZodCheckNumberFormat.init(inst, def);
			$ZodNumber.init(inst, def);
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				payload.issues.push({
					expected: "never",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = Array(input.length);
				const proms = [];
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else handleArrayResult(result, payload, i);
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
			const isPresent = key in input;
			if (result.issues.length) {
				if (isOptionalIn && isOptionalOut && !isPresent) return;
				final.issues.push(...prefixIssues(key, result.issues));
			}
			if (!isPresent && !isOptionalIn) {
				if (!result.issues.length) final.issues.push({
					code: "invalid_type",
					expected: "nonoptional",
					input: void 0,
					path: [key]
				});
				return;
			}
			if (result.value === void 0) {
				if (isPresent) final.value[key] = void 0;
			} else final.value[key] = result.value;
		}
		function normalizeDef(def) {
			const keys = Object.keys(def.shape);
			for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
			const okeys = optionalKeys(def.shape);
			return {
				...def,
				keys,
				keySet: new Set(keys),
				numKeys: keys.length,
				optionalKeys: new Set(okeys)
			};
		}
		function handleCatchall(proms, input, payload, ctx, def, inst) {
			const unrecognized = [];
			const keySet = def.keySet;
			const _catchall = def.catchall._zod;
			const t = _catchall.def.type;
			const isOptionalIn = _catchall.optin === "optional";
			const isOptionalOut = _catchall.optout === "optional";
			for (const key in input) {
				if (key === "__proto__") continue;
				if (keySet.has(key)) continue;
				if (t === "never") {
					unrecognized.push(key);
					continue;
				}
				const r = _catchall.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
				else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
			}
			if (unrecognized.length) payload.issues.push({
				code: "unrecognized_keys",
				keys: unrecognized,
				input,
				inst
			});
			if (!proms.length) return payload;
			return Promise.all(proms).then(() => {
				return payload;
			});
		}
		const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
			$ZodType.init(inst, def);
			if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
				const sh = def.shape;
				Object.defineProperty(def, "shape", { get: () => {
					const newSh = { ...sh };
					Object.defineProperty(def, "shape", { value: newSh });
					return newSh;
				} });
			}
			const _normalized = cached(() => normalizeDef(def));
			defineLazy(inst._zod, "propValues", () => {
				const shape = def.shape;
				const propValues = {};
				for (const key in shape) {
					const field = shape[key]._zod;
					if (field.values) {
						propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
						for (const v of field.values) propValues[key].add(v);
					}
				}
				return propValues;
			});
			const isObject$1 = isObject;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$1(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = {};
				const proms = [];
				const shape = value.shape;
				for (const key of value.keys) {
					const el = shape[key];
					const isOptionalIn = el._zod.optin === "optional";
					const isOptionalOut = el._zod.optout === "optional";
					const r = el._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
					else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
				}
				if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
				return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
			};
		});
		const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
			$ZodObject.init(inst, def);
			const superParse = inst._zod.parse;
			const _normalized = cached(() => normalizeDef(def));
			const generateFastpass = (shape) => {
				const doc = new Doc([
					"shape",
					"payload",
					"ctx"
				]);
				const normalized = _normalized.value;
				const parseStr = (key) => {
					const k = esc(key);
					return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
				};
				doc.write(`const input = payload.value;`);
				const ids = Object.create(null);
				let counter = 0;
				for (const key of normalized.keys) ids[key] = `key_${counter++}`;
				doc.write(`const newResult = {};`);
				for (const key of normalized.keys) {
					const id = ids[key];
					const k = esc(key);
					const schema = shape[key];
					const isOptionalIn = schema?._zod?.optin === "optional";
					const isOptionalOut = schema?._zod?.optout === "optional";
					doc.write(`const ${id} = ${parseStr(key)};`);
					if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }

        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }

      `);
					else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
					else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }

        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }

      `);
				}
				doc.write(`payload.value = newResult;`);
				doc.write(`return payload;`);
				const fn = doc.compile();
				return (payload, ctx) => fn(shape, payload, ctx);
			};
			let fastpass;
			const isObject$2 = isObject;
			const jit = !globalConfig.jitless;
			const fastEnabled = jit && allowsEval.value;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$2(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
					if (!fastpass) fastpass = generateFastpass(def.shape);
					payload = fastpass(payload, ctx);
					if (!catchall) return payload;
					return handleCatchall([], input, payload, ctx, value, inst);
				}
				return superParse(payload, ctx);
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "values", () => {
				if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazy(inst._zod, "pattern", () => {
				if (def.options.every((o) => o._zod.pattern)) {
					const patterns = def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				for (const key of sharedKeys) {
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
				unrecIssue ?? (unrecIssue = iss);
				for (const k of iss.keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k).l = true;
				}
			} else result.issues.push(iss);
			for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
				if (!unrecKeys.has(k)) unrecKeys.set(k, {});
				unrecKeys.get(k).r = true;
			}
			else result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length && unrecIssue) result.issues.push({
				...unrecIssue,
				keys: bothKeys
			});
			if (aborted(result)) return result;
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			result.value = merged.data;
			return result;
		}
		const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
			$ZodType.init(inst, def);
			const values = getEnumValues(def.entries);
			const valuesSet = new Set(values);
			inst._zod.values = valuesSet;
			inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (valuesSet.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
			$ZodType.init(inst, def);
			if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
			const values = new Set(def.values);
			inst._zod.values = values;
			inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (values.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values: def.values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				payload.fallback = true;
				return payload;
			};
		});
		function handleOptionalResult(result, input) {
			if (input === void 0 && (result.issues.length || result.fallback)) return {
				issues: [],
				value: void 0
			};
			return result;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.optout = "optional";
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? new Set([...def.innerType._zod.values, void 0]) : void 0;
			});
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (def.innerType._zod.optin === "optional") {
					const input = payload.value;
					const result = def.innerType._zod.run(payload, ctx);
					if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
					return handleOptionalResult(result, input);
				}
				if (payload.value === void 0) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => {
				const v = def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => {
					payload.value = result.value;
					if (result.issues.length) {
						payload.value = def.catchValue({
							...payload,
							error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
							input: payload.value
						});
						payload.issues = [];
						payload.fallback = true;
					}
					return payload;
				});
				payload.value = result.value;
				if (result.issues.length) {
					payload.value = def.catchValue({
						...payload,
						error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
						input: payload.value
					});
					payload.issues = [];
					payload.fallback = true;
				}
				return payload;
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => def.in._zod.values);
			defineLazy(inst._zod, "optin", () => def.in._zod.optin);
			defineLazy(inst._zod, "optout", () => def.out._zod.optout);
			defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.length) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues,
				fallback: left.fallback
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
			defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/api.js
		// @__NO_SIDE_EFFECTS__
		function _string(Class, params) {
			return new Class({
				type: "string",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _email(Class, params) {
			return new Class({
				type: "string",
				format: "email",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _guid(Class, params) {
			return new Class({
				type: "string",
				format: "guid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuid(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv4(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v4",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv6(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v6",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv7(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v7",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _url(Class, params) {
			return new Class({
				type: "string",
				format: "url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _emoji(Class, params) {
			return new Class({
				type: "string",
				format: "emoji",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _nanoid(Class, params) {
			return new Class({
				type: "string",
				format: "nanoid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link _cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		// @__NO_SIDE_EFFECTS__
		function _cuid(Class, params) {
			return new Class({
				type: "string",
				format: "cuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cuid2(Class, params) {
			return new Class({
				type: "string",
				format: "cuid2",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ulid(Class, params) {
			return new Class({
				type: "string",
				format: "ulid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _xid(Class, params) {
			return new Class({
				type: "string",
				format: "xid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ksuid(Class, params) {
			return new Class({
				type: "string",
				format: "ksuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv4(Class, params) {
			return new Class({
				type: "string",
				format: "ipv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv6(Class, params) {
			return new Class({
				type: "string",
				format: "ipv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv4(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv6(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64(Class, params) {
			return new Class({
				type: "string",
				format: "base64",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64url(Class, params) {
			return new Class({
				type: "string",
				format: "base64url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _e164(Class, params) {
			return new Class({
				type: "string",
				format: "e164",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _jwt(Class, params) {
			return new Class({
				type: "string",
				format: "jwt",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDateTime(Class, params) {
			return new Class({
				type: "string",
				format: "datetime",
				check: "string_format",
				offset: false,
				local: false,
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDate(Class, params) {
			return new Class({
				type: "string",
				format: "date",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoTime(Class, params) {
			return new Class({
				type: "string",
				format: "time",
				check: "string_format",
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDuration(Class, params) {
			return new Class({
				type: "string",
				format: "duration",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _number(Class, params) {
			return new Class({
				type: "number",
				checks: [],
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _int(Class, params) {
			return new Class({
				type: "number",
				check: "number_format",
				abort: false,
				format: "safeint",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _never(Class, params) {
			return new Class({
				type: "never",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lt(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lte(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gt(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gte(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _multipleOf(value, params) {
			return new $ZodCheckMultipleOf({
				check: "multiple_of",
				...normalizeParams(params),
				value
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _regex(pattern, params) {
			return new $ZodCheckRegex({
				check: "string_format",
				format: "regex",
				...normalizeParams(params),
				pattern
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lowercase(params) {
			return new $ZodCheckLowerCase({
				check: "string_format",
				format: "lowercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uppercase(params) {
			return new $ZodCheckUpperCase({
				check: "string_format",
				format: "uppercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _includes(includes, params) {
			return new $ZodCheckIncludes({
				check: "string_format",
				format: "includes",
				...normalizeParams(params),
				includes
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _startsWith(prefix, params) {
			return new $ZodCheckStartsWith({
				check: "string_format",
				format: "starts_with",
				...normalizeParams(params),
				prefix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _endsWith(suffix, params) {
			return new $ZodCheckEndsWith({
				check: "string_format",
				format: "ends_with",
				...normalizeParams(params),
				suffix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _normalize(form) {
			return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
		}
		// @__NO_SIDE_EFFECTS__
		function _trim() {
			return /* @__PURE__ */ _overwrite((input) => input.trim());
		}
		// @__NO_SIDE_EFFECTS__
		function _toLowerCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _toUpperCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _slugify() {
			return /* @__PURE__ */ _overwrite((input) => slugify(input));
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/to-json-schema.js
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				external: params?.external ?? void 0
			};
		}
		function process(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					process(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) Object.assign(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
					};
				}
				if (entry[1] === root) return { ref: "#" };
				const defUriPrefix = `#/${defsSegment}/`;
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + defId
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") {
						extractToDef(entry);
						continue;
					}
				}
			}
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else Object.assign(schema, refSchema);
					Object.assign(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			Object.assign(result, root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					defs[seen.defId] = seen.def;
				}
			}
			if (ctx.external) {} else if (Object.keys(defs).length > 0) if (ctx.target === "draft-2020-12") result.$defs = defs;
			else result.definitions = defs;
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/core/json-schema-processors.js
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time") delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const regexes = [...patterns];
				if (regexes.length === 1) json.pattern = regexes[0].source;
				else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const numberProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
			if (typeof format === "string" && format.includes("int")) json.type = "integer";
			else json.type = "number";
			const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
			const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
			const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
			if (exMin) if (legacy) {
				json.minimum = exclusiveMinimum;
				json.exclusiveMinimum = true;
			} else json.exclusiveMinimum = exclusiveMinimum;
			else if (typeof minimum === "number") json.minimum = minimum;
			if (exMax) if (legacy) {
				json.maximum = exclusiveMaximum;
				json.exclusiveMaximum = true;
			} else json.exclusiveMaximum = exclusiveMaximum;
			else if (typeof maximum === "number") json.maximum = maximum;
			if (typeof multipleOf === "number") json.multipleOf = multipleOf;
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const literalProcessor = (schema, ctx, json, _params) => {
			const def = schema._zod.def;
			const vals = [];
			for (const val of def.values) if (val === void 0) {
				if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
			} else if (typeof val === "bigint") if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
			else vals.push(Number(val));
			else vals.push(val);
			if (vals.length === 0) {} else if (vals.length === 1) {
				const val = vals[0];
				json.type = val === null ? "null" : typeof val;
				if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
				else json.const = val;
			} else {
				if (vals.every((v) => typeof v === "number")) json.type = "number";
				if (vals.every((v) => typeof v === "string")) json.type = "string";
				if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
				if (vals.every((v) => v === null)) json.type = "null";
				json.enum = vals;
			}
		};
		const customProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = schema._zod.bag;
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = process(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			json.properties = {};
			const shape = def.shape;
			for (const key in shape) json.properties[key] = process(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			});
			const allKeys = new Set(Object.keys(shape));
			const requiredKeys = new Set([...allKeys].filter((key) => {
				const v = def.shape[key]._zod;
				if (ctx.io === "input") return v.optin === void 0;
				else return v.optout === void 0;
			}));
			if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => process(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = process(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = process(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.default = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				throw new Error("Dynamic catch values are not supported in JSON Schema");
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/classic/iso.js
		const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
			$ZodISODateTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function datetime(params) {
			return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
		}
		const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
			$ZodISODate.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function date(params) {
			return /* @__PURE__ */ _isoDate(ZodISODate, params);
		}
		const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
			$ZodISOTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function time(params) {
			return /* @__PURE__ */ _isoTime(ZodISOTime, params);
		}
		const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
			$ZodISODuration.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function duration(params) {
			return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
		}
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/classic/errors.js
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			Object.defineProperties(inst, {
				format: { value: (mapper) => formatError(inst, mapper) },
				flatten: { value: (mapper) => flattenError(inst, mapper) },
				addIssue: { value: (issue) => {
					inst.issues.push(issue);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				addIssues: { value: (issues) => {
					inst.issues.push(...issues);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				isEmpty: { get() {
					return inst.issues.length === 0;
				} }
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/node_modules/zod/v4/classic/schemas.js
		const _installedGroups = /* @__PURE__ */ new WeakMap();
		function _installLazyMethods(inst, group, methods) {
			const proto = Object.getPrototypeOf(inst);
			let installed = _installedGroups.get(proto);
			if (!installed) {
				installed = /* @__PURE__ */ new Set();
				_installedGroups.set(proto, installed);
			}
			if (installed.has(group)) return;
			installed.add(group);
			for (const key in methods) {
				const fn = methods[key];
				Object.defineProperty(proto, key, {
					configurable: true,
					enumerable: false,
					get() {
						const bound = fn.bind(this);
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: bound
						});
						return bound;
					},
					set(v) {
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: v
						});
					}
				});
			}
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			$ZodType.init(inst, def);
			Object.assign(inst["~standard"], { jsonSchema: {
				input: createStandardJSONSchemaMethod(inst, "input"),
				output: createStandardJSONSchemaMethod(inst, "output")
			} });
			inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
			inst.def = def;
			inst.type = def.type;
			Object.defineProperty(inst, "_def", { value: def });
			inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
			inst.safeParse = (data, params) => safeParse(inst, data, params);
			inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
			inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
			inst.spa = inst.safeParseAsync;
			inst.encode = (data, params) => encode(inst, data, params);
			inst.decode = (data, params) => decode(inst, data, params);
			inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
			inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
			inst.safeEncode = (data, params) => safeEncode(inst, data, params);
			inst.safeDecode = (data, params) => safeDecode(inst, data, params);
			inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
			inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
			_installLazyMethods(inst, "ZodType", {
				check(...chks) {
					const def = this.def;
					return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
						check: ch,
						def: { check: "custom" },
						onattach: []
					} } : ch)] }), { parent: true });
				},
				with(...chks) {
					return this.check(...chks);
				},
				clone(def, params) {
					return clone(this, def, params);
				},
				brand() {
					return this;
				},
				register(reg, meta) {
					reg.add(this, meta);
					return this;
				},
				refine(check, params) {
					return this.check(refine(check, params));
				},
				superRefine(refinement, params) {
					return this.check(superRefine(refinement, params));
				},
				overwrite(fn) {
					return this.check(/* @__PURE__ */ _overwrite(fn));
				},
				optional() {
					return optional(this);
				},
				exactOptional() {
					return exactOptional(this);
				},
				nullable() {
					return nullable(this);
				},
				nullish() {
					return optional(nullable(this));
				},
				nonoptional(params) {
					return nonoptional(this, params);
				},
				array() {
					return array(this);
				},
				or(arg) {
					return union([this, arg]);
				},
				and(arg) {
					return intersection(this, arg);
				},
				transform(tx) {
					return pipe(this, transform(tx));
				},
				default(d) {
					return _default(this, d);
				},
				prefault(d) {
					return prefault(this, d);
				},
				catch(params) {
					return _catch(this, params);
				},
				pipe(target) {
					return pipe(this, target);
				},
				readonly() {
					return readonly(this);
				},
				describe(description) {
					const cl = this.clone();
					globalRegistry.add(cl, { description });
					return cl;
				},
				meta(...args) {
					if (args.length === 0) return globalRegistry.get(this);
					const cl = this.clone();
					globalRegistry.add(cl, args[0]);
					return cl;
				},
				isOptional() {
					return this.safeParse(void 0).success;
				},
				isNullable() {
					return this.safeParse(null).success;
				},
				apply(fn) {
					return fn(this);
				}
			});
			Object.defineProperty(inst, "description", {
				get() {
					return globalRegistry.get(inst)?.description;
				},
				configurable: true
			});
			return inst;
		});
		/** @internal */
		const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
			const bag = inst._zod.bag;
			inst.format = bag.format ?? null;
			inst.minLength = bag.minimum ?? null;
			inst.maxLength = bag.maximum ?? null;
			_installLazyMethods(inst, "_ZodString", {
				regex(...args) {
					return this.check(/* @__PURE__ */ _regex(...args));
				},
				includes(...args) {
					return this.check(/* @__PURE__ */ _includes(...args));
				},
				startsWith(...args) {
					return this.check(/* @__PURE__ */ _startsWith(...args));
				},
				endsWith(...args) {
					return this.check(/* @__PURE__ */ _endsWith(...args));
				},
				min(...args) {
					return this.check(/* @__PURE__ */ _minLength(...args));
				},
				max(...args) {
					return this.check(/* @__PURE__ */ _maxLength(...args));
				},
				length(...args) {
					return this.check(/* @__PURE__ */ _length(...args));
				},
				nonempty(...args) {
					return this.check(/* @__PURE__ */ _minLength(1, ...args));
				},
				lowercase(params) {
					return this.check(/* @__PURE__ */ _lowercase(params));
				},
				uppercase(params) {
					return this.check(/* @__PURE__ */ _uppercase(params));
				},
				trim() {
					return this.check(/* @__PURE__ */ _trim());
				},
				normalize(...args) {
					return this.check(/* @__PURE__ */ _normalize(...args));
				},
				toLowerCase() {
					return this.check(/* @__PURE__ */ _toLowerCase());
				},
				toUpperCase() {
					return this.check(/* @__PURE__ */ _toUpperCase());
				},
				slugify() {
					return this.check(/* @__PURE__ */ _slugify());
				}
			});
		});
		const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			_ZodString.init(inst, def);
			inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
			inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
			inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
			inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
			inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
			inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
			inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
			inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
			inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
			inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
			inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
			inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
			inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
			inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
			inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
			inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
			inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
			inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
			inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
			inst.datetime = (params) => inst.check(datetime(params));
			inst.date = (params) => inst.check(date(params));
			inst.time = (params) => inst.check(time(params));
			inst.duration = (params) => inst.check(duration(params));
		});
		function string(params) {
			return /* @__PURE__ */ _string(ZodString, params);
		}
		const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			_ZodString.init(inst, def);
		});
		const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
			$ZodEmail.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
			$ZodGUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
			$ZodUUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
			$ZodURL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
			$ZodEmoji.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
			$ZodNanoID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
			$ZodCUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
			$ZodCUID2.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
			$ZodULID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
			$ZodXID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
			$ZodKSUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
			$ZodIPv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
			$ZodIPv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
			$ZodCIDRv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
			$ZodCIDRv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
			$ZodBase64.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
			$ZodBase64URL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
			$ZodE164.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
			$ZodJWT.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
			$ZodNumber.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
			_installLazyMethods(inst, "ZodNumber", {
				gt(value, params) {
					return this.check(/* @__PURE__ */ _gt(value, params));
				},
				gte(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				min(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				lt(value, params) {
					return this.check(/* @__PURE__ */ _lt(value, params));
				},
				lte(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				max(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				int(params) {
					return this.check(int(params));
				},
				safe(params) {
					return this.check(int(params));
				},
				positive(params) {
					return this.check(/* @__PURE__ */ _gt(0, params));
				},
				nonnegative(params) {
					return this.check(/* @__PURE__ */ _gte(0, params));
				},
				negative(params) {
					return this.check(/* @__PURE__ */ _lt(0, params));
				},
				nonpositive(params) {
					return this.check(/* @__PURE__ */ _lte(0, params));
				},
				multipleOf(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				step(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				finite() {
					return this;
				}
			});
			const bag = inst._zod.bag;
			inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
			inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
			inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
			inst.isFinite = true;
			inst.format = bag.format ?? null;
		});
		function number(params) {
			return /* @__PURE__ */ _number(ZodNumber, params);
		}
		const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
			$ZodNumberFormat.init(inst, def);
			ZodNumber.init(inst, def);
		});
		function int(params) {
			return /* @__PURE__ */ _int(ZodNumberFormat, params);
		}
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
			$ZodNever.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
		});
		function never(params) {
			return /* @__PURE__ */ _never(ZodNever, params);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
			_installLazyMethods(inst, "ZodArray", {
				min(n, params) {
					return this.check(/* @__PURE__ */ _minLength(n, params));
				},
				nonempty(params) {
					return this.check(/* @__PURE__ */ _minLength(1, params));
				},
				max(n, params) {
					return this.check(/* @__PURE__ */ _maxLength(n, params));
				},
				length(n, params) {
					return this.check(/* @__PURE__ */ _length(n, params));
				},
				unwrap() {
					return this.element;
				}
			});
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
			$ZodObjectJIT.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
			defineLazy(inst, "shape", () => {
				return def.shape;
			});
			_installLazyMethods(inst, "ZodObject", {
				keyof() {
					return _enum(Object.keys(this._zod.def.shape));
				},
				catchall(catchall) {
					return this.clone({
						...this._zod.def,
						catchall
					});
				},
				passthrough() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				loose() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				strict() {
					return this.clone({
						...this._zod.def,
						catchall: never()
					});
				},
				strip() {
					return this.clone({
						...this._zod.def,
						catchall: void 0
					});
				},
				extend(incoming) {
					return extend(this, incoming);
				},
				safeExtend(incoming) {
					return safeExtend(this, incoming);
				},
				merge(other) {
					return merge(this, other);
				},
				pick(mask) {
					return pick(this, mask);
				},
				omit(mask) {
					return omit(this, mask);
				},
				partial(...args) {
					return partial(ZodOptional, this, args[0]);
				},
				required(...args) {
					return required(ZodNonOptional, this, args[0]);
				}
			});
		});
		function object(shape, params) {
			return new ZodObject({
				type: "object",
				shape: shape ?? {},
				...normalizeParams(params)
			});
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
			$ZodEnum.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
			inst.enum = def.entries;
			inst.options = Object.values(def.entries);
			const keys = new Set(Object.keys(def.entries));
			inst.extract = (values, params) => {
				const newEntries = {};
				for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
			inst.exclude = (values, params) => {
				const newEntries = { ...def.entries };
				for (const value of values) if (keys.has(value)) delete newEntries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
		});
		function _enum(values, params) {
			return new ZodEnum({
				type: "enum",
				entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
				...normalizeParams(params)
			});
		}
		const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
			$ZodLiteral.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
			inst.values = new Set(def.values);
			Object.defineProperty(inst, "value", { get() {
				if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
				return def.values[0];
			} });
		});
		function literal(value, params) {
			return new ZodLiteral({
				type: "literal",
				values: Array.isArray(value) ? value : [value],
				...normalizeParams(params)
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				payload.value = output;
				payload.fallback = true;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/lib/typert-schemas.js
		const stringParameter = (name) => Object.freeze({
			name,
			wire: name,
			source: "json",
			codec: Object.freeze({
				mode: "strict",
				typeSymbol: `@chatecnu-work/dsh-artifact-preview-native#${name}`,
				schema: string()
			})
		});
		const parameters = [stringParameter("sessionId"), stringParameter("relativePath")];
		const officePreviewDescription = object({
			schemaVersion: literal(1),
			kind: _enum(["slides", "document"]),
			sourceHash: string(),
			rendererVersion: string(),
			fontFingerprint: string(),
			cacheKey: string(),
			pageCount: number().int().positive().nullable(),
			pageWidth: number().positive().nullable(),
			pageHeight: number().positive().nullable(),
			warnings: array(object({
				code: string(),
				message: string()
			}).strict())
		}).strict();
		const result = Object.freeze({
			mode: "strict",
			typeSymbol: "@chatecnu-work/dsh-artifact-preview-native#ArtifactPreview",
			schema: object({
				path: string(),
				name: string(),
				mime: string(),
				bytes: number(),
				encoding: _enum([
					"utf8",
					"base64",
					"url"
				]),
				data: string(),
				downloadUrl: string().optional(),
				officePreview: officePreviewDescription.optional()
			}).strict()
		});
		const revealResult = Object.freeze({
			mode: "strict",
			typeSymbol: "@chatecnu-work/dsh-artifact-preview-native#ArtifactReveal",
			schema: object({
				path: string(),
				revealed: literal(true)
			}).strict()
		});
		const importFileSchema = object({
			name: string().min(1).max(512),
			mediaType: string().max(255),
			bytes: number().int().min(0).max(64 * 1024 * 1024),
			data: string()
		}).strict();
		const importParameters = [stringParameter("sessionId"), Object.freeze({
			name: "files",
			wire: "files",
			source: "json",
			codec: Object.freeze({
				mode: "strict",
				typeSymbol: "@chatecnu-work/dsh-artifact-preview-native#WorkspaceImportFiles",
				schema: array(importFileSchema).min(1).max(20)
			})
		})];
		const nativeImportParameters = [stringParameter("sessionId"), stringParameter("grantID")];
		const importResult = Object.freeze({
			mode: "strict",
			typeSymbol: "@chatecnu-work/dsh-artifact-preview-native#WorkspaceImportResult",
			schema: object({ files: array(object({
				path: string(),
				name: string(),
				bytes: number().int().min(0)
			}).strict()) }).strict()
		});
		//#endregion
		//#region node_modules/@chatecnu-work/dsh-artifact-preview-native/lib/typert.remote-client.js
		const pkg = "@chatecnu-work/dsh-artifact-preview-native";
		const TYPERT_REMOTE = {
			package: pkg,
			descriptors: [
				{
					id: `${pkg}#artifactPreview/read`,
					service: "artifactPreview",
					namespace: "artifactPreview",
					method: "read",
					invocation: { kind: "direct" },
					parameters,
					result,
					sourceLocation: {
						file: "dsh-plugins/artifact-preview-native/lib/index.js",
						line: 1,
						column: 1
					}
				},
				{
					id: `${pkg}#artifactPreview/reveal`,
					service: "artifactPreview",
					namespace: "artifactPreview",
					method: "reveal",
					invocation: { kind: "direct" },
					parameters,
					result: revealResult,
					sourceLocation: {
						file: "dsh-plugins/artifact-preview-native/lib/index.js",
						line: 1,
						column: 1
					}
				},
				{
					id: `${pkg}#artifactPreview/importFiles`,
					service: "artifactPreview",
					namespace: "artifactPreview",
					method: "importFiles",
					invocation: { kind: "direct" },
					parameters: importParameters,
					result: importResult,
					sourceLocation: {
						file: "dsh-plugins/artifact-preview-native/lib/index.js",
						line: 1,
						column: 1
					}
				},
				{
					id: `${pkg}#artifactPreview/importNativeFiles`,
					service: "artifactPreview",
					namespace: "artifactPreview",
					method: "importNativeFiles",
					invocation: { kind: "direct" },
					parameters: nativeImportParameters,
					result: importResult,
					sourceLocation: {
						file: "dsh-plugins/artifact-preview-native/lib/index.js",
						line: 1,
						column: 1
					}
				}
			]
		};
		//#endregion
		//#region node_modules/@eduwork/dsh-artifact-services/lib/office-preview-client.js
		const STORE = Symbol.for("@eduwork/office-preview/view-state/v1");
		const EVENT = "eduwork-office-preview-state-v1";
		const STORAGE = "eduwork.office-preview.v1:";
		const LIMIT = 80;
		const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
		const css = `
:host{display:block;height:100%;min-height:260px;color:var(--dsw-alias-label-primary,#27303b);font:12px/1.4 system-ui,sans-serif}
*{box-sizing:border-box}.viewer{height:100%;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#d8dde3);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#eef0f4)}
.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:5px;padding:8px;background:var(--dsw-alias-bg-base,#fff);border-bottom:1px solid var(--dsw-alias-border-l2,#d8dde3);flex:none}
button,select,input{font:inherit;color:inherit;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l2,#ccd2d9);border-radius:5px;height:29px;padding:3px 7px;max-width:100%}
button{cursor:pointer}button:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,#edf1f6)}button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,.viewport:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3777ba);outline-offset:-2px}
.title{width:100%;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.page-number{width:49px;text-align:center;padding:3px}.page-count{white-space:nowrap}.expand{margin-left:auto}
.viewport{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;position:relative;padding:12px}
.stage{position:relative;margin:auto;flex:none;background:white;box-shadow:0 2px 10px #1f293722}.page-frame{display:block;position:absolute;top:0;left:0;border:0;transform-origin:0 0;background:white}
.warnings{flex:none;max-height:100px;overflow:auto;padding:6px 10px;background:var(--dsw-alias-bg-layer-2,#fff7e8);color:var(--dsw-alias-state-warn-label,#765324);font-size:11px}.warnings p{margin:3px 0}.error{padding:20px;color:var(--dsw-alias-state-error-primary,#9c2635);background:var(--dsw-alias-bg-base,#fff)}
`;
		function savedState(win, key, count) {
			let state = (win[STORE] || (win[STORE] = /* @__PURE__ */ new Map())).get(key);
			if (!state) try {
				state = JSON.parse(win.sessionStorage.getItem(STORAGE + key) || "null");
			} catch {}
			return normalizeState(state, count);
		}
		function normalizeState(state, count) {
			return {
				page: clamp(Math.trunc(Number(state?.page) || 1), 1, count),
				mode: [
					"fit-page",
					"fit-width",
					"manual"
				].includes(state?.mode) ? state.mode : "fit-page",
				scale: clamp(Number(state?.scale) || 1, .1, 4)
			};
		}
		function saveState(win, key, state) {
			const memory = win[STORE] || (win[STORE] = /* @__PURE__ */ new Map());
			memory.delete(key);
			memory.set(key, { ...state });
			while (memory.size > LIMIT) memory.delete(memory.keys().next().value);
			try {
				win.sessionStorage.setItem(STORAGE + key, JSON.stringify(state));
				const keys = [];
				for (let i = 0; i < win.sessionStorage.length; i++) {
					const item = win.sessionStorage.key(i);
					if (item?.startsWith(STORAGE)) keys.push(item);
				}
				while (keys.length > LIMIT) {
					const oldest = keys.shift();
					if (oldest !== STORAGE + key) win.sessionStorage.removeItem(oldest);
				}
			} catch {}
			win.dispatchEvent(new win.CustomEvent(EVENT, { detail: {
				key,
				state: { ...state }
			} }));
		}
		function readPages(doc, preview) {
			if (typeof preview?.html !== "string" || !preview.html.startsWith("<!doctype html>")) throw new Error("文件预览返回无效内容");
			const parsed = new doc.defaultView.DOMParser().parseFromString(preview.html, "text/html");
			parsed.querySelectorAll("script,iframe,object,embed,link,base,meta[http-equiv=\"refresh\"]").forEach((node) => node.remove());
			const policy = parsed.createElement("meta");
			policy.httpEquiv = "Content-Security-Policy";
			policy.content = "default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
			parsed.head.prepend(policy);
			const main = parsed.querySelector("main.slides[data-slide-width][data-slide-height]");
			if (!main) return {
				fixed: false,
				pages: ["<!doctype html>" + parsed.documentElement.outerHTML],
				width: 900,
				height: 0
			};
			const width = Number(main.dataset.slideWidth), height = Number(main.dataset.slideHeight);
			const sections = [...main.querySelectorAll(":scope > section.slide-wrap")];
			const count = Number(main.dataset.slideCount);
			const declaredLimit = preview.description?.warnings?.some((warning) => warning.code === "page-limit");
			if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 1e5 || height > 1e5 || !sections.length || !Number.isInteger(count) || sections.length > count || sections.length < count && !declaredLimit) throw new Error("文件预览的页面尺寸或页数不完整");
			const description = preview.description;
			if (description && (description.kind !== "slides" || description.pageCount !== count || Math.abs(description.pageWidth - width) > .01 || Math.abs(description.pageHeight - height) > .01)) throw new Error("预览描述与实际文件页面不一致");
			const style = parsed.createElement("style");
			style.textContent = `html,body{margin:0!important;padding:0!important;width:${width}px!important;height:${height}px!important;min-height:0!important;overflow:hidden!important}main.slides{display:block!important;margin:0!important;padding:0!important;width:${width}px!important;height:${height}px!important}main.slides>section.slide-wrap{margin:0!important;padding:0!important;width:${width}px!important;height:${height}px!important;max-width:none!important}.slide-label,.preview-meta,[data-office-warning]{display:none!important}`;
			parsed.head.append(style);
			parsed.body.replaceChildren(main);
			return {
				fixed: true,
				pages: sections,
				width,
				height,
				total: count,
				pageHTML(index) {
					main.replaceChildren(sections[index]);
					return "<!doctype html>" + parsed.documentElement.outerHTML;
				}
			};
		}
		/** Mount the same isolated file viewer in Studio or a conversation attachment. */
		function mountOfficePreview(container, initialOptions) {
			const doc = container.ownerDocument, win = doc.defaultView;
			let options = { ...initialOptions }, source, state, key, scale = 1, destroyed = false, lastPage = -1;
			const host = doc.createElement("div");
			host.dataset.officePreviewViewer = "";
			host.style.height = "100%";
			container.append(host);
			const root = host.attachShadow({ mode: "open" });
			const style = doc.createElement("style");
			style.textContent = css;
			root.append(style);
			const create = (tag, className, text) => {
				const element = doc.createElement(tag);
				if (className) element.className = className;
				if (text) element.textContent = text;
				return element;
			};
			const viewer = create("div", "viewer"), toolbar = create("div", "toolbar"), title = create("div", "title"), viewport = create("div", "viewport"), stage = create("div", "stage"), warnings = create("div", "warnings");
			toolbar.setAttribute("role", "toolbar");
			toolbar.setAttribute("aria-label", "文件预览工具栏");
			viewport.tabIndex = 0;
			viewport.setAttribute("aria-label", "文件页面");
			root.append(viewer);
			viewer.append(toolbar, viewport, warnings);
			viewport.append(stage);
			toolbar.append(title);
			const button = (text, label, action) => {
				const node = create("button", "", text);
				node.type = "button";
				node.setAttribute("aria-label", label);
				node.addEventListener("click", action);
				toolbar.append(node);
				return node;
			};
			const previous = button("‹", "上一页", () => change({ page: state.page - 1 }));
			const pageInput = create("input", "page-number");
			pageInput.type = "number";
			pageInput.min = "1";
			pageInput.setAttribute("aria-label", "当前页码");
			toolbar.append(pageInput);
			pageInput.addEventListener("change", () => change({ page: Number(pageInput.value) }));
			const count = create("span", "page-count");
			toolbar.append(count);
			const next = button("›", "下一页", () => change({ page: state.page + 1 }));
			const mode = create("select");
			mode.setAttribute("aria-label", "页面缩放模式");
			toolbar.append(mode);
			for (const [value, label] of [
				["fit-page", "适应页面"],
				["fit-width", "适应宽度"],
				["manual", "100%"]
			]) {
				const item = create("option", "", label);
				item.value = value;
				mode.append(item);
			}
			mode.addEventListener("change", () => change({
				mode: mode.value,
				scale: mode.value === "manual" ? scale : state.scale
			}));
			const minus = button("−", "缩小", () => change({
				mode: "manual",
				scale: scale / 1.2
			}));
			button("100%", "原始尺寸 100%", () => change({
				mode: "manual",
				scale: 1
			}));
			const plus = button("+", "放大", () => change({
				mode: "manual",
				scale: scale * 1.2
			}));
			const expand = button("展开阅读", "展开阅读", () => options.onExpand?.());
			expand.className = "expand";
			const frame = create("iframe", "page-frame");
			frame.setAttribute("sandbox", "");
			frame.setAttribute("referrerpolicy", "no-referrer");
			frame.dataset.officeFilePreview = "";
			stage.append(frame);
			function measure() {
				if (destroyed || !source) return;
				const width = Math.max(1, viewport.clientWidth - 24), height = Math.max(1, viewport.clientHeight - 24);
				scale = state.mode === "manual" ? state.scale : !source.fixed ? Math.min(1, width / source.width) : state.mode === "fit-width" ? width / source.width : Math.min(width / source.width, height / source.height);
				scale = clamp(scale, .01, 8);
				const frameHeight = source.fixed ? source.height : height / scale;
				Object.assign(stage.style, {
					width: `${source.width * scale}px`,
					height: `${frameHeight * scale}px`,
					marginTop: `${source.fixed ? Math.max(0, (height - frameHeight * scale) / 2) : 0}px`
				});
				Object.assign(frame.style, {
					width: `${source.width}px`,
					height: `${frameHeight}px`,
					transform: `scale(${scale})`
				});
				mode.options[2].textContent = `${Math.round(scale * 100)}%`;
				mode.value = state.mode;
				minus.disabled = scale <= .1;
				plus.disabled = scale >= 4;
				host.dataset.officeScale = String(scale);
				host.dataset.officeMode = state.mode;
			}
			function render() {
				title.textContent = options.title || "文件预览";
				frame.title = options.title || "Office 文件预览";
				expand.hidden = typeof options.onExpand !== "function";
				for (const item of [
					previous,
					pageInput,
					count,
					next
				]) item.hidden = !source.fixed;
				mode.options[0].textContent = source.fixed ? "适应页面" : "适应窗口";
				pageInput.value = String(state.page);
				pageInput.max = String(source.pages.length);
				count.textContent = `/ ${source.pages.length}${source.total > source.pages.length ? `（文件共 ${source.total} 页）` : ""}`;
				previous.disabled = state.page <= 1;
				next.disabled = state.page >= source.pages.length;
				host.dataset.officePage = String(state.page);
				host.dataset.officeCacheKey = key;
				host.dataset.officeSourceHash = options.preview.description?.sourceHash || "";
				if (lastPage !== state.page) {
					frame.srcdoc = source.fixed ? source.pageHTML(state.page - 1) : source.pages[0];
					lastPage = state.page;
					viewport.scrollTop = 0;
					viewport.scrollLeft = 0;
				}
				warnings.replaceChildren();
				for (const warning of options.preview.description?.warnings || []) {
					const text = create("p", "", warning.message);
					text.dataset.officeWarningCode = warning.code;
					warnings.append(text);
				}
				warnings.hidden = !warnings.childElementCount;
				measure();
			}
			function change(patch) {
				if (!source) return;
				state = normalizeState({
					...state,
					...patch
				}, source.pages.length);
				render();
				saveState(win, key, state);
				options.onStateChange?.({
					...state,
					scale
				});
			}
			function load() {
				source = readPages(doc, options.preview);
				key = options.preview.description?.cacheKey;
				if (typeof key !== "string" || !key) key = "legacy:" + Math.random().toString(36).slice(2);
				state = savedState(win, key, source.pages.length);
				lastPage = -1;
				render();
			}
			const receive = (event) => {
				if (event.detail?.key !== key) return;
				state = normalizeState(event.detail.state, source.pages.length);
				render();
			};
			win.addEventListener(EVENT, receive);
			viewport.addEventListener("keydown", (event) => {
				if (event.target !== viewport || !source?.fixed) return;
				if ([
					"ArrowRight",
					"PageDown",
					"ArrowLeft",
					"PageUp",
					"Home",
					"End"
				].includes(event.key)) {
					event.preventDefault();
					change({ page: event.key === "Home" ? 1 : event.key === "End" ? source.pages.length : state.page + (["ArrowRight", "PageDown"].includes(event.key) ? 1 : -1) });
				}
			});
			const observer = new win.ResizeObserver(measure);
			observer.observe(viewport);
			function report(error) {
				source = null;
				viewport.replaceChildren(create("div", "error", `文件已生成，但预览无法显示。${error.message || String(error)} 请打开或下载原文件。`));
				viewport.firstChild.setAttribute("role", "alert");
				toolbar.hidden = true;
				warnings.hidden = true;
				options.onError?.(error);
			}
			try {
				load();
			} catch (error) {
				report(error);
			}
			return {
				update(nextOptions) {
					if (destroyed) return;
					const old = options.preview;
					options = {
						...options,
						...nextOptions
					};
					try {
						if (options.preview !== old) {
							viewport.replaceChildren(stage);
							toolbar.hidden = false;
							load();
						} else if (source) render();
					} catch (error) {
						report(error);
					}
				},
				getState() {
					return state ? {
						...state,
						scale
					} : null;
				},
				destroy() {
					if (destroyed) return;
					destroyed = true;
					observer.disconnect();
					win.removeEventListener(EVENT, receive);
					frame.removeAttribute("srcdoc");
					host.remove();
				}
			};
		}
		//#endregion
		//#region ../../core/session/src/surface.ts
		/** Runtime counterpart of the message-producing event union. */
		const SURFACE_EVENT_TYPES = new Set([
			"system/message",
			"user/message",
			"assistant/message",
			"tool/result"
		]);
		/**
		* Narrow an event to a surface-eligible event carrying its required marker.
		* @param event - event to test.
		* @returns true when both the type and marker identify a surface event.
		*/
		function isSurfaceEvent(event) {
			if (!SURFACE_EVENT_TYPES.has(event.type)) return false;
			return event.surfaceOp !== void 0;
		}
		/**
		* Narrow an event to an append-origin surface event: one that entered the
		* surface at its own log position and was never itself a replacement copy.
		*
		* The model-visible surface deliberately shadows replaced ranges, so it is the
		* wrong source for a human transcript — a landed replacement would erase
		* conversation the user already saw. Append-origin events are that transcript's
		* durable source material; replacement copies stay model-only.
		* @param event - event to test.
		* @returns true when the event appended to the surface tail.
		*/
		function isAppendSurfaceEvent(event) {
			return isSurfaceEvent(event) && event.surfaceOp === "append";
		}
		//#endregion
		//#region src/client/deliverable-utils.js
		const renderedPreviews = new Set([
			"png",
			"jpg",
			"jpeg",
			"webp",
			"gif",
			"mp3",
			"wav",
			"ogg",
			"opus",
			"m4a",
			"aac",
			"flac",
			"mp4",
			"webm",
			"mov",
			"pdf",
			"md",
			"html",
			"docx",
			"xlsx",
			"pptx"
		]);
		const textViews = new Set([
			"txt",
			"json",
			"csv"
		]);
		const sourceViews = new Set([
			"js",
			"ts",
			"tsx",
			"jsx",
			"css",
			"py",
			"go",
			"java",
			"xml",
			"yml",
			"yaml"
		]);
		const visuals = Object.freeze({
			docx: {
				glyph: "W",
				tone: "#3569b8",
				label: "Word 文档",
				kind: "office"
			},
			xlsx: {
				glyph: "X",
				tone: "#287a4b",
				label: "Excel 工作簿",
				kind: "office"
			},
			pptx: {
				glyph: "P",
				tone: "#bd5a31",
				label: "PowerPoint 演示文稿",
				kind: "office"
			},
			pdf: {
				glyph: "PDF",
				tone: "#c14444",
				label: "PDF 文档",
				kind: "office"
			},
			png: {
				glyph: "图",
				tone: "#7a58aa",
				label: "图片",
				kind: "image"
			},
			jpg: {
				glyph: "图",
				tone: "#7a58aa",
				label: "图片",
				kind: "image"
			},
			jpeg: {
				glyph: "图",
				tone: "#7a58aa",
				label: "图片",
				kind: "image"
			},
			webp: {
				glyph: "图",
				tone: "#7a58aa",
				label: "图片",
				kind: "image"
			},
			gif: {
				glyph: "图",
				tone: "#7a58aa",
				label: "图片",
				kind: "image"
			},
			mp3: {
				glyph: "声",
				tone: "#9a5c24",
				label: "音频",
				kind: "audio"
			},
			wav: {
				glyph: "声",
				tone: "#9a5c24",
				label: "音频",
				kind: "audio"
			},
			ogg: {
				glyph: "声",
				tone: "#9a5c24",
				label: "音频",
				kind: "audio"
			},
			opus: {
				glyph: "声",
				tone: "#9a5c24",
				label: "音频",
				kind: "audio"
			},
			m4a: {
				glyph: "声",
				tone: "#9a5c24",
				label: "音频",
				kind: "audio"
			},
			aac: {
				glyph: "声",
				tone: "#9a5c24",
				label: "音频",
				kind: "audio"
			},
			flac: {
				glyph: "声",
				tone: "#9a5c24",
				label: "音频",
				kind: "audio"
			},
			mp4: {
				glyph: "影",
				tone: "#5b5aaa",
				label: "视频",
				kind: "video"
			},
			mov: {
				glyph: "影",
				tone: "#5b5aaa",
				label: "视频",
				kind: "video"
			},
			webm: {
				glyph: "影",
				tone: "#5b5aaa",
				label: "视频",
				kind: "video"
			},
			md: {
				glyph: "M",
				tone: "#59616c",
				label: "Markdown",
				kind: "file"
			},
			txt: {
				glyph: "T",
				tone: "#59616c",
				label: "文本文件",
				kind: "file"
			},
			json: {
				glyph: "{}",
				tone: "#59616c",
				label: "JSON 文件",
				kind: "file"
			},
			csv: {
				glyph: "CSV",
				tone: "#287a4b",
				label: "CSV 文件",
				kind: "file"
			}
		});
		const mimeVisuals = Object.freeze({
			"application/pdf": "pdf",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx"
		});
		function basename(path) {
			const value = String(path ?? "");
			const at = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
			return at === -1 ? value : value.slice(at + 1);
		}
		function extension(path) {
			const name = basename(path);
			const at = name.lastIndexOf(".");
			return at <= 0 ? "" : name.slice(at + 1).toLowerCase();
		}
		function normalizedPath(path) {
			return String(path ?? "").replaceAll("\\", "/");
		}
		function pathSegments(path) {
			return normalizedPath(path).split("/").filter(Boolean);
		}
		function shortestUniqueLabels(paths) {
			const segments = paths.map(pathSegments);
			return paths.map((path, index) => {
				const own = segments[index];
				for (let depth = 1; depth <= own.length; depth += 1) {
					const candidate = own.slice(-depth).join("/");
					if (segments.every((other, otherIndex) => otherIndex === index || other.slice(-depth).join("/") !== candidate)) return candidate;
				}
				return normalizedPath(path);
			});
		}
		function previewSupport(path) {
			const ext = extension(path);
			if (renderedPreviews.has(ext)) return "rendered";
			if (textViews.has(ext)) return "text";
			if (sourceViews.has(ext)) return "source";
			return "unsupported";
		}
		function previewActionLabel(path) {
			const support = previewSupport(path);
			if (support === "rendered") return "预览";
			if (support === "source") return "查看源码";
			if (support === "text") return "查看文本";
			return "查看详情";
		}
		function previewModeLabel(path) {
			const support = previewSupport(path);
			if (support === "source") return "源码查看";
			if (support === "text") return "文本查看";
			if (support === "unsupported") return "暂不支持预览";
			return "文件预览";
		}
		function resolvedVisual(path, mime = "") {
			const ext = extension(path);
			if (visuals[ext] !== void 0) return visuals[ext];
			const normalizedMime = String(mime ?? "").trim().toLowerCase();
			const mimeExtension = mimeVisuals[normalizedMime];
			if (mimeExtension !== void 0) return visuals[mimeExtension];
			if (normalizedMime.startsWith("image/")) return visuals.png;
			if (normalizedMime.startsWith("audio/")) return visuals.mp3;
			if (normalizedMime.startsWith("video/")) return visuals.mp4;
			return {
				glyph: ext.length > 0 && ext.length <= 4 ? ext.toUpperCase() : "文",
				tone: "#657080",
				label: ext.length > 0 ? `${ext.toUpperCase()} 文件` : "文件",
				kind: "file"
			};
		}
		function fileVisual(path, mime = "") {
			const { glyph, tone, label } = resolvedVisual(path, mime);
			return {
				glyph,
				tone,
				label
			};
		}
		function artifactCardProfile(path, mime = "") {
			const visual = resolvedVisual(path, mime);
			return {
				title: visual.kind === "image" || visual.kind === "audio" || visual.kind === "video" ? `生成的${visual.label}` : visual.label,
				activity: visual.label,
				icon: visual.glyph,
				kind: visual.kind
			};
		}
		function artifactPathFromBlock(block) {
			const argsRaw = typeof block?.argsRaw === "string" ? block.argsRaw : block?.call?.argsRaw;
			if (typeof argsRaw !== "string") return "";
			try {
				const args = JSON.parse(argsRaw);
				return typeof args?.relative_path === "string" ? args.relative_path.trim() : "";
			} catch {
				return "";
			}
		}
		//#endregion
		//#region src/client/produced-file-tracker.js
		const resultPathTools = new Set([
			"artifact_publish",
			"image_generate",
			"ecnu_image_generate",
			"ecnu_tts_generate",
			"speech_synthesize",
			"media_render",
			"video_project",
			"office_document",
			"office_spreadsheet",
			"office_presentation",
			"office_pdf"
		]);
		const officeWriteActions = new Set([
			"create",
			"edit",
			"merge",
			"extract"
		]);
		function parsedArguments(argsRaw) {
			try {
				const value = JSON.parse(argsRaw);
				return isRecord(value) ? value : null;
			} catch {
				return null;
			}
		}
		function pathValue(value) {
			return typeof value === "string" && value.trim().length > 0 ? value : null;
		}
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function validEditArgs(args) {
			return typeof args.old_string === "string" && args.old_string.length > 0 && typeof args.new_string === "string" && args.old_string !== args.new_string && (args.replace_all === void 0 || typeof args.replace_all === "boolean");
		}
		function editorMutationPath(args) {
			const path = pathValue(args.path);
			if (path === null) return null;
			switch (args.command) {
				case "create": return typeof args.file_text === "string" ? path : null;
				case "str_replace": return typeof args.old_str === "string" && args.old_str.length > 0 && (args.new_str === void 0 || typeof args.new_str === "string") ? path : null;
				case "insert": return typeof args.insert_line === "number" && Number.isInteger(args.insert_line) && args.insert_line >= 0 && typeof args.new_str === "string" ? path : null;
				default: return null;
			}
		}
		function argumentArtifactPath(name, args) {
			switch (name) {
				case "write": return typeof args.content === "string" ? pathValue(args.file_path) : null;
				case "edit": return validEditArgs(args) ? pathValue(args.file_path) : null;
				case "str_replace_editor": return editorMutationPath(args);
				case "artifact_publish": return pathValue(args.relative_path);
				case "office_document":
				case "office_spreadsheet":
				case "office_presentation":
				case "office_pdf": return typeof args.action === "string" && officeWriteActions.has(args.action.toLowerCase()) ? pathValue(args.output_path) : null;
				default: return null;
			}
		}
		function uniquePaths(paths) {
			return [...new Set(paths.filter((path) => typeof path === "string" && path.trim().length > 0))];
		}
		function trackedArtifactCall(name, argsRaw) {
			const args = parsedArguments(argsRaw);
			const path = args === null ? null : argumentArtifactPath(name, args);
			return {
				name,
				paths: path === null ? [] : [path]
			};
		}
		function successfulArtifactPaths(call, meta) {
			if (call === void 0) return [];
			const resultPath = resultPathTools.has(call.name) && isRecord(meta) ? pathValue(meta.relativePath) : null;
			return uniquePaths([...call.paths, resultPath]);
		}
		//#endregion
		//#region src/client/deliverables.js
		const h$3 = react.default.createElement;
		const collapsedLimit = 4;
		const artifactMarkdownLabels = Object.freeze({
			code: Object.freeze({
				copyLabel: "复制代码",
				copiedLabel: "已复制"
			}),
			footnotes: "脚注"
		});
		function producedForClosing(data, seq = Number.POSITIVE_INFINITY) {
			if (data === void 0) return [];
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			for (const produced of data.produced) {
				if (produced.seq > seq || seen.has(produced.path)) continue;
				seen.add(produced.path);
				paths.push(produced.path);
			}
			return paths;
		}
		function selectProducedFiles(owner) {
			const paths = producedForClosing(owner.turn.data.get("deliverables"), owner.seq);
			return paths.length === 0 ? null : paths;
		}
		const deliverablesDefinition = {
			kind: "deliverables",
			match: (event) => {
				if (event.type === "turn/start") return {
					id: String(event.data.turn),
					role: "start"
				};
				if (event.type === "tool/call") return {
					id: String(event.data.turn),
					role: "update"
				};
				if (event.type === "tool/result" && isAppendSurfaceEvent(event)) return {
					id: String(event.data.turn),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "turn/start") throw new Error("deliverables start requires turn/start");
				return {
					turn: match.event.data.turn,
					calls: /* @__PURE__ */ new Map(),
					produced: []
				};
			},
			update: (context, match) => {
				if (match.event.type === "tool/call") {
					const calls = new Map(context.state.calls);
					calls.set(String(match.event.data.callId), trackedArtifactCall(match.event.data.name, match.event.data.arguments));
					return {
						...context.state,
						calls
					};
				}
				if (match.event.type !== "tool/result") return context.state;
				if (match.event.data.message.content[0].isError === true) return context.state;
				const callId = String(match.event.data.message.source.callId);
				const additions = successfulArtifactPaths(context.state.calls.get(callId), match.event.data.meta).map((path) => ({
					seq: match.event.seq,
					path
				}));
				return additions.length === 0 ? context.state : {
					...context.state,
					produced: [...context.state.produced, ...additions]
				};
			},
			buildLocationData: (context, scope) => scope !== "turn" || context.state === void 0 ? null : {
				kind: "turn",
				turn: context.state.turn,
				key: "deliverables",
				value: { produced: context.state.produced }
			}
		};
		function onlyPathWithBasename(paths, value) {
			const matches = paths.filter((path) => basename(path) === value);
			return matches.length === 1 ? matches[0] : void 0;
		}
		function producedFileMentions(paths, open) {
			return { resolve(value) {
				const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value);
				if (path === void 0) return void 0;
				return {
					open: () => open(path),
					label: `打开 ${path}`,
					title: path
				};
			} };
		}
		const smallButton = {
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			padding: "5px 9px",
			background: "var(--dsw-alias-bg-base)",
			color: "inherit",
			cursor: "pointer",
			fontSize: 12
		};
		const closeButton = {
			border: 0,
			background: "transparent",
			color: "inherit",
			cursor: "pointer",
			fontSize: 22,
			lineHeight: 1
		};
		const menuButton = {
			display: "block",
			width: "100%",
			padding: "8px 10px",
			border: 0,
			borderRadius: 7,
			background: "transparent",
			color: "inherit",
			cursor: "pointer",
			textAlign: "left",
			fontSize: 12
		};
		const artifactInteractiveCss = `
[data-chatecnu-artifact-action] { transition: background-color .14s ease, border-color .14s ease, color .14s ease; }
[data-chatecnu-artifact-action]:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent)) !important; }
[data-chatecnu-artifact-action]:focus-visible { outline: 2px solid var(--dsw-alias-interactive-focus, #5963c7); outline-offset: 2px; }
[data-chatecnu-artifact-row]:hover { border-color: var(--dsw-alias-border-l1, var(--dsw-alias-border-l2)) !important; background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 6%, transparent)) !important; }
`;
		function isMarkdownPreview(preview, path) {
			return preview?.mime === "text/markdown" || extension(path) === "md";
		}
		function isHtmlPreview(preview, path) {
			return preview?.mime === "text/html" || [
				"html",
				"docx",
				"xlsx",
				"pptx"
			].includes(extension(path));
		}
		function sandboxedHtml(source) {
			const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:">`;
			if (/<head(?:\s[^>]*)?>/i.test(source)) return source.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${policy}`);
			return `<!doctype html><html><head><meta charset="utf-8">${policy}</head><body>${source}</body></html>`;
		}
		function formattedText(preview) {
			if (preview.mime !== "application/json") return preview.data;
			try {
				return JSON.stringify(JSON.parse(preview.data), null, 2);
			} catch {
				return preview.data;
			}
		}
		function OfficePreviewContent({ preview, expand }) {
			const container = (0, react.useRef)(null);
			const controller = (0, react.useRef)(null);
			const [error, setError] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				setError("");
				const viewer = mountOfficePreview(container.current, {
					preview: {
						html: preview.data,
						bytes: preview.bytes,
						description: preview.officePreview
					},
					title: preview.name,
					onExpand: expand,
					onError: (error) => setError(error.message || String(error))
				});
				controller.current = viewer;
				return () => {
					viewer.destroy();
					controller.current = null;
				};
			}, [preview]);
			(0, react.useEffect)(() => {
				controller.current?.update({ onExpand: expand });
			}, [expand]);
			return h$3("div", {
				style: {
					height: "100%",
					minHeight: 0
				},
				"data-conversation-office-preview": ""
			}, error && h$3("p", { role: "alert" }, error), h$3("div", {
				ref: container,
				style: {
					height: "100%",
					minHeight: 0
				}
			}));
		}
		function PreviewContent({ preview, path, sourceMode, expand }) {
			const source = preview.encoding === "base64" ? `data:${preview.mime};base64,${preview.data}` : preview.encoding === "url" ? preview.data : void 0;
			if (preview.mime.startsWith("image/")) return h$3("img", {
				src: source,
				alt: preview.name,
				style: {
					display: "block",
					width: "100%",
					height: "100%",
					objectFit: "contain"
				}
			});
			if (preview.mime.startsWith("audio/")) return h$3("div", { style: {
				display: "grid",
				placeItems: "center",
				height: "100%",
				padding: 24
			} }, h$3("audio", {
				src: source,
				controls: true,
				style: { width: "min(100%, 560px)" }
			}));
			if (preview.mime.startsWith("video/")) return h$3("div", { style: {
				display: "grid",
				placeItems: "center",
				height: "100%",
				padding: 16,
				background: "#111"
			} }, h$3("video", {
				src: source,
				controls: true,
				preload: "metadata",
				style: {
					display: "block",
					width: "100%",
					height: "100%",
					objectFit: "contain"
				}
			}));
			if (preview.mime === "application/pdf") return h$3("iframe", {
				src: source,
				title: preview.name,
				style: {
					width: "100%",
					height: "100%",
					border: 0,
					background: "#fff"
				}
			});
			if (isMarkdownPreview(preview, path) && !sourceMode) return h$3("div", { style: {
				height: "100%",
				overflow: "auto",
				padding: "20px 22px",
				background: "var(--dsw-alias-bg-base)"
			} }, h$3(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
				text: preview.data,
				labels: artifactMarkdownLabels
			}));
			if (["slides", "document"].includes(preview.officePreview?.kind) && !sourceMode) return h$3(OfficePreviewContent, {
				preview,
				expand
			});
			if (isHtmlPreview(preview, path) && !sourceMode) return h$3("iframe", {
				srcDoc: sandboxedHtml(preview.data),
				sandbox: "",
				referrerPolicy: "no-referrer",
				title: preview.name,
				style: {
					width: "100%",
					height: "100%",
					border: 0,
					background: "#fff"
				}
			});
			return h$3("pre", { style: {
				margin: 0,
				padding: 18,
				minHeight: "100%",
				overflow: "auto",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				font: "12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace"
			} }, formattedText(preview));
		}
		function FileGlyph({ path, size = 28 }) {
			const visual = fileVisual(path);
			return h$3("span", {
				"aria-hidden": "true",
				title: visual.label,
				style: {
					display: "inline-grid",
					flex: "0 0 auto",
					placeItems: "center",
					width: size,
					height: size,
					borderRadius: Math.max(6, Math.round(size * .24)),
					background: `color-mix(in srgb, ${visual.tone} 14%, var(--dsw-alias-bg-base))`,
					border: `1px solid color-mix(in srgb, ${visual.tone} 28%, transparent)`,
					color: visual.tone,
					fontSize: visual.glyph.length > 2 ? Math.max(8, size * .28) : Math.max(11, size * .42),
					fontWeight: 760
				}
			}, visual.glyph);
		}
		const emptyPanel = Object.freeze({
			sessionId: null,
			tabs: [],
			activePath: null
		});
		let previewPanel = emptyPanel;
		let previewRequest = 0;
		const previewListeners = /* @__PURE__ */ new Set();
		let previewDetailsActivation;
		function publishPreviewPanel(next) {
			previewPanel = next;
			for (const listener of previewListeners) listener();
		}
		function subscribePreviewPanel(listener) {
			previewListeners.add(listener);
			return () => previewListeners.delete(listener);
		}
		function updatePreviewTab(sessionId, path, update) {
			if (previewPanel.sessionId !== sessionId) return;
			const tabs = previewPanel.tabs.map((tab) => tab.path === path ? update(tab) : tab);
			publishPreviewPanel({
				...previewPanel,
				tabs
			});
		}
		function openArtifactPreview({ sessionId, path, previewFile, openFile, openDetails }) {
			if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("请先打开产生该文件的会话");
			if (openDetails(path, sessionId) === true) return;
			const requestId = ++previewRequest;
			const existing = previewPanel.sessionId === sessionId ? previewPanel.tabs.filter((tab) => tab.path !== path) : [];
			const support = previewSupport(path);
			const tab = {
				path,
				support,
				busy: support !== "unsupported",
				error: "",
				preview: null,
				requestId,
				openFile
			};
			publishPreviewPanel({
				sessionId,
				tabs: [...existing, tab].slice(-8),
				activePath: path
			});
			previewDetailsActivation?.activate();
			if (support === "unsupported") return;
			Promise.resolve(previewFile(sessionId, path)).then((preview) => updatePreviewTab(sessionId, path, (current) => current.requestId === requestId ? {
				...current,
				busy: false,
				preview,
				error: ""
			} : current), (cause) => updatePreviewTab(sessionId, path, (current) => current.requestId === requestId ? {
				...current,
				busy: false,
				preview: null,
				error: cause instanceof Error ? cause.message : String(cause)
			} : current));
		}
		function selectPreviewTab(sessionId, path) {
			if (previewPanel.sessionId === sessionId && previewPanel.tabs.some((tab) => tab.path === path)) publishPreviewPanel({
				...previewPanel,
				activePath: path
			});
		}
		function closePreviewTab(sessionId, path) {
			if (previewPanel.sessionId !== sessionId) return false;
			const index = previewPanel.tabs.findIndex((tab) => tab.path === path);
			const tabs = previewPanel.tabs.filter((tab) => tab.path !== path);
			if (tabs.length === 0) {
				publishPreviewPanel(emptyPanel);
				previewDetailsActivation?.deactivate();
				return true;
			}
			const activePath = previewPanel.activePath === path ? tabs[Math.min(index, tabs.length - 1)].path : previewPanel.activePath;
			publishPreviewPanel({
				...previewPanel,
				tabs,
				activePath
			});
			return false;
		}
		function clearPreviewPanel(sessionId) {
			if (previewPanel.sessionId !== sessionId) return;
			publishPreviewPanel(emptyPanel);
			previewDetailsActivation?.deactivate();
		}
		function Breadcrumbs({ path }) {
			const segments = pathSegments(path);
			return h$3("div", {
				title: normalizedPath(path),
				style: {
					minWidth: 0,
					display: "flex",
					alignItems: "center",
					gap: 5,
					overflow: "hidden",
					color: "var(--dsw-alias-label-secondary)",
					fontSize: 12
				}
			}, segments.map((segment, index) => h$3(react.default.Fragment, { key: `${segment}-${index}` }, index > 0 && h$3("span", {
				"aria-hidden": "true",
				style: { color: "var(--dsw-alias-label-tertiary)" }
			}, "›"), h$3("span", { style: {
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				flex: index === segments.length - 1 ? "0 1 auto" : "0 10 auto",
				fontWeight: index === segments.length - 1 ? 650 : 400,
				color: index === segments.length - 1 ? "var(--dsw-alias-label-primary)" : void 0
			} }, segment))));
		}
		function ArtifactDetailsPanel({ sessionId, previewFile, revealFile, closeDetails }) {
			const state = (0, react.useSyncExternalStore)(subscribePreviewPanel, () => previewPanel, () => emptyPanel);
			const [sourceMode, setSourceMode] = (0, react.useState)(false);
			const [actionError, setActionError] = (0, react.useState)("");
			const active = state.sessionId === sessionId ? state.tabs.find((tab) => tab.path === state.activePath) : void 0;
			(0, react.useEffect)(() => {
				if (state.sessionId !== null && state.sessionId !== sessionId) clearPreviewPanel(state.sessionId);
			}, [sessionId, state.sessionId]);
			(0, react.useEffect)(() => {
				setSourceMode(false);
				setActionError("");
			}, [active?.path]);
			(0, react.useEffect)(() => {
				if (active === void 0) return void 0;
				const key = (event) => {
					if (event.key !== "Escape") return;
					clearPreviewPanel(sessionId);
					closeDetails();
				};
				window.addEventListener("keydown", key);
				return () => window.removeEventListener("keydown", key);
			}, [
				active,
				closeDetails,
				sessionId
			]);
			if (active === void 0) return null;
			const labels = shortestUniqueLabels(state.tabs.map((tab) => tab.path));
			const dismiss = () => {
				clearPreviewPanel(sessionId);
				closeDetails();
			};
			const retry = () => openArtifactPreview({
				sessionId,
				path: active.path,
				previewFile,
				openFile: active.openFile,
				openDetails: () => {}
			});
			const reveal = async () => {
				setActionError("");
				try {
					await revealFile(sessionId, active.path);
				} catch (cause) {
					setActionError(cause instanceof Error ? cause.message : String(cause));
				}
			};
			return h$3("section", {
				role: "dialog",
				"aria-label": `预览 ${active.path}`,
				style: {
					position: "relative",
					width: "100%",
					height: "100%",
					minWidth: 0,
					display: "grid",
					gridTemplateRows: state.tabs.length > 1 ? "auto auto minmax(0, 1fr)" : "auto minmax(0, 1fr)",
					background: "var(--dsw-alias-bg-base)",
					color: "var(--dsw-alias-label-primary)"
				}
			}, state.tabs.length > 1 && h$3("nav", {
				"aria-label": "已打开的产物",
				style: {
					display: "flex",
					gap: 3,
					padding: "7px 8px 0",
					overflowX: "auto",
					borderBottom: "1px solid var(--dsw-alias-border-l2)"
				}
			}, state.tabs.map((tab, index) => h$3("span", {
				key: tab.path,
				style: {
					display: "inline-flex",
					alignItems: "center",
					minWidth: 0,
					maxWidth: 210,
					borderRadius: "8px 8px 0 0",
					background: tab.path === active.path ? "var(--dsw-alias-bg-module-platform)" : "transparent"
				}
			}, h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				title: normalizedPath(tab.path),
				onClick: () => selectPreviewTab(sessionId, tab.path),
				style: {
					minWidth: 0,
					padding: "6px 5px 6px 9px",
					border: 0,
					background: "transparent",
					color: "inherit",
					cursor: "pointer",
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					fontSize: 11
				}
			}, labels[index]), h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				"aria-label": `关闭 ${labels[index]}`,
				onClick: () => {
					if (closePreviewTab(sessionId, tab.path)) closeDetails();
				},
				style: {
					border: 0,
					background: "transparent",
					color: "var(--dsw-alias-label-tertiary)",
					cursor: "pointer",
					padding: "4px 7px"
				}
			}, "×")))), h$3("header", { style: {
				display: "grid",
				gridTemplateColumns: "minmax(0, 1fr) auto",
				alignItems: "center",
				gap: 10,
				padding: "10px 12px",
				borderBottom: "1px solid var(--dsw-alias-border-l2)"
			} }, h$3("span", { style: {
				minWidth: 0,
				display: "grid",
				gap: 2
			} }, h$3(Breadcrumbs, { path: active.path }), h$3("small", { style: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 10
			} }, previewModeLabel(active.path))), h$3("span", { style: {
				display: "flex",
				alignItems: "center",
				gap: 5
			} }, active.preview && (isMarkdownPreview(active.preview, active.path) || isHtmlPreview(active.preview, active.path)) && h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: () => setSourceMode((value) => !value),
				style: smallButton
			}, sourceMode ? "预览" : "源码"), h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: reveal,
				style: smallButton
			}, "定位"), h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: () => active.openFile(active.path),
				style: smallButton
			}, "打开"), h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: dismiss,
				"aria-label": "关闭预览",
				style: closeButton
			}, "×")), actionError && h$3("p", {
				role: "alert",
				style: {
					gridColumn: "1 / -1",
					margin: 0,
					color: "var(--dsw-alias-state-error-primary)",
					fontSize: 11
				}
			}, actionError)), h$3("div", { style: {
				minHeight: 0,
				display: "grid",
				placeItems: active.busy || active.error || active.support === "unsupported" ? "center" : "stretch",
				overflow: "hidden",
				background: "var(--dsw-alias-bg-module-platform)"
			} }, active.busy ? h$3("p", { style: { color: "var(--dsw-alias-label-secondary)" } }, "正在读取预览…") : active.error ? h$3("div", { style: {
				maxWidth: 360,
				padding: 24,
				textAlign: "center"
			} }, h$3("p", { role: "alert" }, active.error), h$3("span", { style: {
				display: "flex",
				justifyContent: "center",
				gap: 8
			} }, h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: retry,
				style: smallButton
			}, "重试"), h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: () => active.openFile(active.path),
				style: smallButton
			}, "使用本机应用打开"))) : active.support === "unsupported" ? h$3("div", { style: {
				maxWidth: 380,
				padding: 28,
				textAlign: "center"
			} }, h$3(FileGlyph, {
				path: active.path,
				size: 42
			}), h$3("h3", { style: {
				margin: "12px 0 6px",
				fontSize: 15
			} }, "该文件类型暂不支持预览"), h$3("p", { style: {
				margin: "0 0 15px",
				color: "var(--dsw-alias-label-secondary)",
				fontSize: 12,
				lineHeight: 1.6
			} }, `${fileVisual(active.path).label}需要由本机应用完整呈现。`), h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: () => active.openFile(active.path),
				style: smallButton
			}, "使用本机应用打开")) : h$3(PreviewContent, {
				preview: active.preview,
				path: active.path,
				sourceMode
			})));
		}
		function ContextMenu({ menu, path, onPreview, onOpen, onReveal, onError, onClose }) {
			(0, react.useEffect)(() => {
				const close = () => onClose();
				const key = (event) => {
					if (event.key === "Escape") onClose();
				};
				window.addEventListener("pointerdown", close);
				window.addEventListener("keydown", key);
				return () => {
					window.removeEventListener("pointerdown", close);
					window.removeEventListener("keydown", key);
				};
			}, [onClose]);
			const action = (callback) => (event) => {
				event.stopPropagation();
				onClose();
				Promise.resolve().then(callback).catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)));
			};
			return h$3("div", {
				role: "menu",
				onPointerDown: (event) => event.stopPropagation(),
				style: {
					position: "fixed",
					zIndex: 11600,
					left: Math.min(menu.x, window.innerWidth - 210),
					top: Math.min(menu.y, window.innerHeight - 190),
					width: 196,
					padding: 6,
					border: "1px solid var(--dsw-alias-border-l2)",
					borderRadius: 10,
					background: "var(--dsw-alias-bg-base)",
					color: "var(--dsw-alias-label-primary)",
					boxShadow: "0 12px 38px rgba(0,0,0,.2)"
				}
			}, h$3("button", {
				type: "button",
				role: "menuitem",
				"data-chatecnu-artifact-action": "",
				onClick: action(onPreview),
				style: menuButton
			}, previewActionLabel(path)), h$3("button", {
				type: "button",
				role: "menuitem",
				"data-chatecnu-artifact-action": "",
				onClick: action(onOpen),
				style: menuButton
			}, "打开"), h$3("button", {
				type: "button",
				role: "menuitem",
				"data-chatecnu-artifact-action": "",
				onClick: action(onReveal),
				style: menuButton
			}, "在文件夹中显示"), h$3("button", {
				type: "button",
				role: "menuitem",
				"data-chatecnu-artifact-action": "",
				onClick: action(() => navigator.clipboard?.writeText(path)),
				style: menuButton
			}, "复制路径"));
		}
		function ProducedFiles({ matched: paths, openFile, previewFile, revealFile, openDetails, sessionId }) {
			const [menu, setMenu] = (0, react.useState)(null);
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [actionError, setActionError] = (0, react.useState)("");
			const shown = expanded ? paths : paths.slice(0, collapsedLimit);
			const hidden = paths.length - shown.length;
			const labels = shortestUniqueLabels(paths);
			const labelByPath = new Map(paths.map((path, index) => [path, labels[index]]));
			const openPreview = (path) => openArtifactPreview({
				sessionId,
				path,
				previewFile,
				openFile,
				openDetails
			});
			return h$3(react.default.Fragment, null, h$3("section", { style: {
				display: "grid",
				gap: 6,
				margin: "12px 0 4px",
				padding: 9,
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 11,
				background: "var(--dsw-alias-bg-module-platform)"
			} }, h$3("header", { style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 10,
				padding: "0 2px 2px"
			} }, h$3("strong", { style: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: 12,
				fontWeight: 650
			} }, `生成的文件 · ${paths.length}`), paths.length > collapsedLimit && h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: () => setExpanded((value) => !value),
				style: {
					...smallButton,
					padding: "3px 7px",
					borderColor: "transparent",
					background: "transparent",
					color: "var(--dsw-alias-label-secondary)"
				}
			}, expanded ? "收起" : `再显示 ${hidden} 个`)), h$3("div", { style: {
				display: "grid",
				gap: 5
			} }, shown.map((path) => h$3("div", {
				key: path,
				"data-chatecnu-artifact-row": "",
				style: {
					display: "grid",
					gridTemplateColumns: "minmax(0, 1fr) auto",
					alignItems: "center",
					border: "1px solid transparent",
					borderRadius: 9,
					background: "var(--dsw-alias-bg-base)",
					transition: "background-color .14s ease, border-color .14s ease"
				}
			}, h$3("button", {
				type: "button",
				title: normalizedPath(path),
				onClick: () => openPreview(path),
				onContextMenu: (event) => {
					event.preventDefault();
					setMenu({
						path,
						x: event.clientX,
						y: event.clientY
					});
				},
				style: {
					minWidth: 0,
					display: "flex",
					alignItems: "center",
					gap: 9,
					padding: "6px 7px",
					border: 0,
					background: "transparent",
					color: "inherit",
					cursor: "pointer",
					textAlign: "left"
				}
			}, h$3(FileGlyph, { path }), h$3("span", { style: { minWidth: 0 } }, h$3("span", { style: {
				display: "block",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				fontSize: 12
			} }, labelByPath.get(path)), h$3("span", { style: {
				display: "block",
				marginTop: 1,
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 10
			} }, fileVisual(path).label))), h$3("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				"aria-label": `更多操作：${labelByPath.get(path)}`,
				onClick: (event) => {
					const rect = event.currentTarget.getBoundingClientRect();
					setMenu({
						path,
						x: rect.right - 190,
						y: rect.bottom + 4
					});
				},
				style: {
					border: 0,
					borderRadius: 7,
					background: "transparent",
					color: "var(--dsw-alias-label-secondary)",
					cursor: "pointer",
					padding: "7px 10px",
					fontSize: 16
				}
			}, "⋯")))), actionError && h$3("p", {
				role: "alert",
				style: {
					margin: "2px 2px 0",
					color: "var(--dsw-alias-state-error-primary)",
					fontSize: 11
				}
			}, actionError)), menu && h$3(ContextMenu, {
				menu,
				path: menu.path,
				onPreview: () => openPreview(menu.path),
				onOpen: () => openFile(menu.path),
				onReveal: () => revealFile(sessionId, menu.path),
				onError: setActionError,
				onClose: () => setMenu(null)
			}));
		}
		function installDeliverables(ctx, { previewFile, revealFile, openDetails = () => ctx.layout.openDetails(), officialSidebar = false }) {
			ctx.uiConversation.events.register(deliverablesDefinition);
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				select: selectProducedFiles,
				inject: () => ({
					previewFile,
					revealFile,
					openDetails
				})
			}, ProducedFiles));
			if (!officialSidebar) ctx.slots.inject("details", () => {
				let disposeEntry;
				const activation = {
					activate() {
						if (disposeEntry !== void 0) return;
						disposeEntry = ctx.slots.register({
							name: "details",
							priority: -100,
							inject: () => ({
								previewFile,
								revealFile,
								closeDetails: () => ctx.layout.closeDetails()
							})
						}, ArtifactDetailsPanel);
					},
					deactivate() {
						disposeEntry?.();
						disposeEntry = void 0;
					}
				};
				previewDetailsActivation = activation;
				if (previewPanel.tabs.length > 0) activation.activate();
				return () => {
					activation.deactivate();
					if (previewDetailsActivation === activation) previewDetailsActivation = void 0;
				};
			});
			ctx.provide("chatFileMentions", { forClosing(owner) {
				const paths = selectProducedFiles(owner);
				return paths === null ? void 0 : producedFileMentions(paths, owner.openFile);
			} });
		}
		//#endregion
		//#region ../../context/file-reference/src/grammar.ts
		/**
		* Format a selected path as prompt text. Whitespace uses the quoted
		* `@"path"` grammar; a quoted directory keeps that quote open after its
		* trailing slash so completion can descend another level.
		* @param candidate - selected file or directory.
		* @param preserveQuote - retain an explicitly opened quote even when unnecessary.
		* @returns the insertion value, or `undefined` for a path the editor grammar cannot represent safely.
		*/
		function formatFileMention(candidate, preserveQuote) {
			const path = candidate.kind === "directory" ? `${candidate.path}/` : candidate.path;
			if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return void 0;
			if (!(preserveQuote || /\s/u.test(path))) return `@${path}`;
			if (candidate.kind === "directory") return `@"${path}`;
			return `@"${path}"`;
		}
		//#endregion
		//#region src/client/paste-target.js
		/**
		* Return whether a clipboard event originated from DSH's current composer.
		*
		* DSH 0.1.2 uses a Lexical contenteditable root instead of the textarea used
		* by older releases. Inspect the composed path so paste events dispatched
		* from a paragraph or another Lexical child still resolve to that root.
		*/
		function isComposerPasteEvent(event) {
			return (typeof event?.composedPath === "function" ? event.composedPath() : [event?.target]).some((node) => typeof node?.matches === "function" && node.matches("[data-composer-input]"));
		}
		//#endregion
		//#region src/client/input-files.js
		const h$2 = react.default.createElement;
		const IMAGE_TYPES = new Set([
			"image/png",
			"image/jpeg",
			"image/webp",
			"image/gif"
		]);
		const MAX_FILES = 20;
		const MAX_FILE_BYTES = 64 * 1024 * 1024;
		const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
		const MAX_BROWSER_FALLBACK_BYTES = 4 * 1024 * 1024;
		const NATIVE_GRANT_CALLBACK = "__chatecnuNativeFileGrant";
		const NATIVE_REQUEST_MARKER_X = -314159;
		let nativeCorrelation = 0;
		function workspaceFileReference(path) {
			const mention = formatFileMention({
				kind: "file",
				path
			}, false);
			if (mention === void 0) throw new Error("导入后的文件路径无法表示为 @file 引用");
			const label = path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
			if (label === void 0) throw new Error("导入后的文件名无效");
			return {
				source: "reference",
				ref: mention,
				label,
				appearance: "file",
				clipboardText: mention
			};
		}
		function fileToBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onerror = () => reject(reader.error ?? /* @__PURE__ */ new Error(`无法读取文件“${file.name || "file"}”`));
				reader.onabort = () => reject(/* @__PURE__ */ new Error(`文件读取已取消：“${file.name || "file"}”`));
				reader.onload = () => {
					if (typeof reader.result !== "string") {
						reject(/* @__PURE__ */ new Error(`无法读取文件“${file.name || "file"}”`));
						return;
					}
					const comma = reader.result.indexOf(",");
					if (comma < 0) {
						reject(/* @__PURE__ */ new Error(`文件编码失败：“${file.name || "file"}”`));
						return;
					}
					resolve(reader.result.slice(comma + 1));
				};
				reader.readAsDataURL(file);
			});
		}
		async function uploadPayload(file) {
			return {
				name: file.name || "file",
				mediaType: file.type || "application/octet-stream",
				bytes: file.size,
				data: await fileToBase64(file)
			};
		}
		function validateDocuments(files) {
			if (files.length > MAX_FILES) throw new Error(`一次最多添加 ${MAX_FILES} 个文件`);
			if (files.some((file) => file.size > MAX_FILE_BYTES)) throw new Error("单个文件不能超过 64 MiB");
			if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error("一次添加的文件总大小不能超过 128 MiB");
		}
		function validateBrowserFallback(files) {
			if (files.some((file) => file.size > MAX_BROWSER_FALLBACK_BYTES)) throw new Error("当前浏览器环境无法安全导入超过 4 MiB 的文件；请使用 ChatECNU Work 桌面版");
		}
		function nativeFileBridge() {
			const webview = window.chrome?.webview;
			if (typeof webview?.postMessageWithAdditionalObjects !== "function") return null;
			return { resolveFilePaths(marker, correlation, files) {
				webview.postMessageWithAdditionalObjects(`file:drop:${marker}:${correlation}`, files);
			} };
		}
		function FileDropOverlay({ busy }) {
			return (0, react_dom.createPortal)(h$2("div", {
				role: "status",
				"data-chatecnu-file-drop": "",
				style: {
					position: "fixed",
					inset: 0,
					zIndex: 1e4,
					display: "grid",
					placeItems: "center",
					pointerEvents: "none",
					background: "color-mix(in srgb, var(--dsw-alias-bg-mask-1, rgba(0,0,0,.32)) 82%, transparent)",
					backdropFilter: "blur(5px)"
				}
			}, h$2("div", { style: {
				minWidth: 280,
				padding: "25px 30px",
				border: "1px dashed var(--dsw-alias-border-l2)",
				borderRadius: 16,
				background: "var(--dsw-alias-bg-module-platform, #fff)",
				color: "var(--dsw-alias-label-primary)",
				textAlign: "center",
				boxShadow: "0 18px 50px rgba(0,0,0,.16)"
			} }, h$2("div", {
				"aria-hidden": true,
				style: {
					fontSize: 32,
					marginBottom: 8
				}
			}, "⇩"), h$2("strong", { style: {
				display: "block",
				fontSize: 15
			} }, busy ? "当前正在处理文件" : "松开即可添加到对话"), h$2("span", { style: {
				display: "block",
				marginTop: 6,
				color: "var(--dsw-alias-label-secondary)",
				fontSize: 12
			} }, "图片使用 DSH 原生附件，其他文件复制到当前工作区"))), document.body);
		}
		function AddMenu({ anchor, onFiles, onCommands, close }) {
			const menuRef = (0, react.useRef)(null);
			const rect = anchor.current?.getBoundingClientRect();
			(0, react.useEffect)(() => {
				const onPointerDown = (event) => {
					if (!(event.target instanceof Node) || menuRef.current?.contains(event.target) || anchor.current?.contains(event.target)) return;
					close();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") close();
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown, true);
				window.addEventListener("resize", close);
				window.addEventListener("scroll", close, true);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown, true);
					window.removeEventListener("resize", close);
					window.removeEventListener("scroll", close, true);
				};
			}, [anchor, close]);
			if (rect === void 0) return null;
			const row = {
				display: "grid",
				gridTemplateColumns: "24px minmax(0, 1fr)",
				alignItems: "center",
				gap: 8,
				width: "100%",
				minHeight: 38,
				padding: "7px 10px",
				border: 0,
				borderRadius: 8,
				background: "transparent",
				color: "var(--dsw-alias-label-primary)",
				cursor: "pointer",
				textAlign: "left"
			};
			return (0, react_dom.createPortal)(h$2("div", {
				ref: menuRef,
				role: "menu",
				"aria-label": "添加到对话",
				"data-chatecnu-add-menu": "",
				style: {
					position: "fixed",
					zIndex: 10020,
					left: Math.max(8, rect.left),
					bottom: window.innerHeight - rect.top + 8,
					width: 230,
					padding: 6,
					border: "1px solid var(--dsw-alias-border-l2)",
					borderRadius: 12,
					background: "var(--dsw-alias-bg-module-platform, #fff)",
					boxShadow: "0 14px 40px rgba(0,0,0,.16)"
				}
			}, h$2("button", {
				type: "button",
				role: "menuitem",
				style: row,
				onMouseDown: (event) => event.preventDefault(),
				onClick: onFiles
			}, h$2("span", {
				"aria-hidden": true,
				style: {
					display: "grid",
					placeItems: "center"
				}
			}, h$2(_deepseek_ai_dsh_client_ui_primitives.IconPaperclipOutline16, { size: 16 })), h$2("span", null, h$2("strong", { style: {
				display: "block",
				fontSize: 13
			} }, "文件和图片"), h$2("small", { style: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: 11
			} }, "添加到当前对话和工作区"))), h$2("button", {
				type: "button",
				role: "menuitem",
				style: row,
				onMouseDown: (event) => event.preventDefault(),
				onClick: onCommands
			}, h$2("span", {
				"aria-hidden": true,
				style: { fontSize: 16 }
			}, "⌘"), h$2("span", null, h$2("strong", { style: {
				display: "block",
				fontSize: 13
			} }, "命令与工作流"), h$2("small", { style: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: 11
			} }, "打开 DSH 原生命令菜单")))), document.body);
		}
		function WorkspaceFileInput({ sessionId, input, inputActions, locked, onAddImages, openCommands, commandMenuOpen, insertReference, importFiles, importNativeFiles, notify }) {
			const pickerRef = (0, react.useRef)(null);
			const buttonRef = (0, react.useRef)(null);
			const latestRef = (0, react.useRef)({
				sessionId,
				input,
				inputActions,
				onAddImages,
				insertReference,
				importFiles,
				importNativeFiles,
				notify
			});
			const nativePendingRef = (0, react.useRef)(/* @__PURE__ */ new Map());
			const nativeCallbackRef = (0, react.useRef)(null);
			const runningRef = (0, react.useRef)(false);
			const [running, setRunning] = (0, react.useState)(false);
			const [dragActive, setDragActive] = (0, react.useState)(false);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			latestRef.current = {
				sessionId,
				input,
				inputActions,
				onAddImages,
				insertReference,
				importFiles,
				importNativeFiles,
				notify
			};
			(0, react.useEffect)(() => {
				if (commandMenuOpen) setMenuOpen(false);
			}, [commandMenuOpen]);
			const ensureNativeListener = () => {
				if (nativeCallbackRef.current !== null) return true;
				if (nativeFileBridge() === null) return false;
				const callback = (receipt) => {
					const correlation = Number(receipt?.correlation);
					const pending = nativePendingRef.current.get(correlation);
					if (pending === void 0) return;
					nativePendingRef.current.delete(correlation);
					clearTimeout(pending.timeout);
					if (typeof receipt?.error === "string" && receipt.error !== "") {
						pending.reject(new Error(receipt.error));
						return;
					}
					if (typeof receipt?.grant !== "string" || !/^[a-f0-9]{32}$/u.test(receipt.grant)) {
						pending.reject(/* @__PURE__ */ new Error("桌面文件授权无效"));
						return;
					}
					pending.resolve(receipt);
				};
				window[NATIVE_GRANT_CALLBACK] = callback;
				nativeCallbackRef.current = callback;
				return true;
			};
			(0, react.useEffect)(() => {
				ensureNativeListener();
				return () => {
					if (window[NATIVE_GRANT_CALLBACK] === nativeCallbackRef.current) delete window[NATIVE_GRANT_CALLBACK];
					nativeCallbackRef.current = null;
					for (const pending of nativePendingRef.current.values()) {
						clearTimeout(pending.timeout);
						pending.reject(/* @__PURE__ */ new Error("文件导入已取消"));
					}
					nativePendingRef.current.clear();
				};
			}, []);
			const resolveNativeGrant = (files) => {
				const bridge = nativeFileBridge();
				if (bridge === null || !ensureNativeListener()) return null;
				nativeCorrelation = nativeCorrelation >= 2e9 ? 1 : nativeCorrelation + 1;
				const correlation = nativeCorrelation;
				return new Promise((resolve, reject) => {
					const timeout = setTimeout(() => {
						nativePendingRef.current.delete(correlation);
						reject(/* @__PURE__ */ new Error("桌面文件复制超时"));
					}, 12e4);
					nativePendingRef.current.set(correlation, {
						resolve,
						reject,
						timeout
					});
					try {
						bridge.resolveFilePaths(NATIVE_REQUEST_MARKER_X, correlation, files);
					} catch (error) {
						clearTimeout(timeout);
						nativePendingRef.current.delete(correlation);
						reject(error);
					}
				});
			};
			const accept = async (fileList) => {
				const files = Array.from(fileList ?? []);
				if (files.length === 0 || runningRef.current) return;
				const current = latestRef.current;
				if (current.input?.phase !== "plain" || current.inputActions === void 0) {
					current.notify("请等待当前消息提交完成后再添加文件");
					return;
				}
				runningRef.current = true;
				setRunning(true);
				try {
					const images = files.filter((file) => IMAGE_TYPES.has(file.type));
					const documents = files.filter((file) => !IMAGE_TYPES.has(file.type));
					validateDocuments(documents);
					if (documents.length > 0) {
						const nativeGrant = typeof current.importNativeFiles === "function" ? resolveNativeGrant(documents) : null;
						let result;
						if (nativeGrant !== null) {
							const receipt = await nativeGrant;
							if (!Array.isArray(receipt.files) || receipt.files.length !== documents.length) throw new Error("桌面文件复制结果不完整");
							result = await current.importNativeFiles(current.sessionId, receipt.grant);
						} else {
							validateBrowserFallback(documents);
							const payloads = [];
							for (const file of documents) payloads.push(await uploadPayload(file));
							result = await current.importFiles(current.sessionId, payloads);
						}
						const latest = latestRef.current;
						if (latest.input?.phase !== "plain" || latest.inputActions === void 0) throw new Error("文件已复制到工作区，但当前输入状态已变化；请使用 @file 重新选择");
						if (typeof latest.insertReference !== "function") throw new Error("文件已复制到工作区，但当前输入组件不支持文件卡片；请使用 @file 重新选择");
						for (const file of result.files) if (latest.insertReference(workspaceFileReference(file.path)) !== true) throw new Error("文件已复制到工作区，但文件卡片未能加入当前输入；请使用 @file 重新选择");
					}
					if (images.length > 0) {
						if (typeof current.onAddImages !== "function") throw new Error("DSH 图片附件入口暂时不可用");
						current.onAddImages(images);
					}
				} catch (error) {
					current.notify(error instanceof Error ? error.message : String(error));
				} finally {
					runningRef.current = false;
					setRunning(false);
				}
			};
			(0, react.useEffect)(() => {
				let depth = 0;
				const fileTransfer = (event) => event.dataTransfer?.types?.includes("Files") === true ? event.dataTransfer : null;
				const stop = (event) => {
					event.preventDefault();
					event.stopImmediatePropagation();
				};
				const reset = () => {
					depth = 0;
					setDragActive(false);
				};
				const onDragEnter = (event) => {
					if (fileTransfer(event) === null) return;
					stop(event);
					depth += 1;
					setDragActive(true);
				};
				const onDragOver = (event) => {
					const transfer = fileTransfer(event);
					if (transfer === null) return;
					stop(event);
					transfer.dropEffect = runningRef.current ? "none" : "copy";
				};
				const onDragLeave = (event) => {
					if (fileTransfer(event) === null) return;
					stop(event);
					depth = Math.max(0, depth - 1);
					if (depth === 0) setDragActive(false);
					if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) reset();
				};
				const onDrop = (event) => {
					const transfer = fileTransfer(event);
					if (transfer === null) return;
					reset();
					const files = Array.from(transfer.files);
					if (files.length > 0 && files.every((file) => IMAGE_TYPES.has(file.type))) return;
					stop(event);
					accept(transfer.files);
				};
				const onPaste = (event) => {
					if (!isComposerPasteEvent(event)) return;
					const itemFiles = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file) => file !== null);
					const files = itemFiles.length > 0 ? itemFiles : Array.from(event.clipboardData?.files ?? []);
					if (files.length === 0 || files.every((file) => IMAGE_TYPES.has(file.type))) return;
					event.preventDefault();
					event.stopImmediatePropagation();
					accept(files);
				};
				document.addEventListener("dragenter", onDragEnter, true);
				document.addEventListener("dragover", onDragOver, true);
				document.addEventListener("dragleave", onDragLeave, true);
				document.addEventListener("drop", onDrop, true);
				document.addEventListener("paste", onPaste, true);
				window.addEventListener("dragend", reset);
				return () => {
					document.removeEventListener("dragenter", onDragEnter, true);
					document.removeEventListener("dragover", onDragOver, true);
					document.removeEventListener("dragleave", onDragLeave, true);
					document.removeEventListener("drop", onDrop, true);
					document.removeEventListener("paste", onPaste, true);
					window.removeEventListener("dragend", reset);
				};
			}, []);
			return h$2(react.default.Fragment, null, h$2("input", {
				ref: pickerRef,
				type: "file",
				multiple: true,
				tabIndex: -1,
				"aria-hidden": true,
				"data-chatecnu-workspace-file-picker": "",
				style: { display: "none" },
				onChange: (event) => {
					accept(event.currentTarget.files);
					event.currentTarget.value = "";
				}
			}), h$2("button", {
				ref: buttonRef,
				type: "button",
				title: "添加",
				"aria-label": "添加",
				"aria-haspopup": "menu",
				"aria-expanded": menuOpen || commandMenuOpen,
				disabled: running || locked || input?.phase !== "plain",
				onMouseDown: (event) => {
					event.preventDefault();
				},
				onClick: () => {
					setMenuOpen((value) => !value);
				},
				style: {
					display: "inline-grid",
					placeItems: "center",
					width: 28,
					height: 28,
					padding: 0,
					border: 0,
					borderRadius: 8,
					background: "transparent",
					color: "var(--dsw-alias-label-secondary)",
					cursor: running ? "wait" : "pointer",
					fontSize: 16
				}
			}, running ? "…" : h$2(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 14 })), menuOpen ? h$2(AddMenu, {
				anchor: buttonRef,
				close: () => setMenuOpen(false),
				onFiles: () => {
					setMenuOpen(false);
					pickerRef.current?.click();
				},
				onCommands: () => {
					setMenuOpen(false);
					openCommands?.();
				}
			}) : null, dragActive ? h$2(FileDropOverlay, { busy: running }) : null);
		}
		//#endregion
		//#region ../../util/workspace-path/src/file-address.ts
		/** The scheme and type every file address opens with. */
		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		/** Component-encode one id or path segment, keeping `:` literal for drive letters. */
		function encodeSegment(segment) {
			return encodeURIComponent(segment).replace(/%3A/gi, ":");
		}
		/** Encode a `/`-separated path segment by segment. */
		function encodePath(path) {
			return path.split("/").map(encodeSegment).join("/");
		}
		/** Whether a decoded first path segment is a Windows drive (`C:`). */
		function isDriveSegment(segment) {
			return segment !== void 0 && /^[A-Za-z]:$/.test(segment);
		}
		/**
		* Build the address of a file read through one Session.
		* @param sessionId - the Session whose Host workspace resolves the path.
		* @param path - absolute or workspace-relative path; backslashes are normalized to `/`, and leading `./` prefixes are dropped.
		* @returns the `dsh-resource://file/session/<sessionId>/<path>` address.
		*/
		function sessionFileAddress(sessionId, path) {
			const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
			return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
		}
		/**
		* Read a file address back into its parts without resolving `.` or `..`.
		* Query and fragment suffixes are ignored; encoded path segments are decoded.
		* @param address - a candidate address.
		* @returns the parts, or `undefined` when the string is not a `dsh-resource://file/` URI in a known scope with a path, or a segment is not validly encoded.
		*/
		function parseFileAddress(address) {
			try {
				if (!address.startsWith(FILE_ADDRESS_PREFIX)) return void 0;
				const end = address.search(/[?#]/);
				const [scope, ...rest] = address.slice(20, end === -1 ? void 0 : end).split("/");
				if (scope === "session") {
					const [id, ...segments] = rest;
					if (id === void 0 || id === "" || segments.length === 0) return void 0;
					return {
						scope,
						sessionId: decodeURIComponent(id),
						path: segments.map(decodeURIComponent).join("/")
					};
				}
				if (scope === "absolute") {
					const unc = rest[0] === "" && rest.length > 1;
					const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent);
					if (segments.length === 0 || segments[0] === "") return void 0;
					if (unc) return {
						scope,
						path: `//${segments.join("/")}`
					};
					return {
						scope,
						path: isDriveSegment(segments[0]) ? segments.join("/") : `/${segments.join("/")}`
					};
				}
				return;
			} catch {
				return;
			}
		}
		//#endregion
		//#region src/client/sidebar-preview.js
		const h$1 = react.default.createElement;
		const id = "@eduwork/workspace-artifact-preview";
		const renderedExtensions = [
			"docx",
			"xlsx",
			"pptx",
			"mp3",
			"wav",
			"ogg",
			"opus",
			"m4a",
			"aac",
			"flac",
			"mp4",
			"webm",
			"mov"
		];
		const button = {
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 7,
			padding: "5px 9px",
			background: "var(--dsw-alias-bg-base)",
			color: "inherit",
			cursor: "pointer",
			fontSize: 12
		};
		const artifactTabDefinition = {
			id,
			kind: "eduwork-artifact",
			priority: "extension",
			patterns: renderedExtensions.map((value) => `*.${value}`),
			canOpen: (address) => {
				const file = parseFileAddress(address);
				return file !== void 0 && renderedExtensions.includes(extension(file.path));
			},
			title: (address) => basename(parseFileAddress(address)?.path || address)
		};
		function ArtifactTab({ useTabInfo, sessionId, previewFile, revealFile }) {
			const { tab } = useTabInfo();
			const file = parseFileAddress(tab.contentId);
			const ownerSession = file?.scope === "session" ? file.sessionId : sessionId;
			const path = file?.path;
			const [read, setRead] = (0, react.useState)({ busy: true });
			const [retry, setRetry] = (0, react.useState)(0);
			const [sourceMode, setSourceMode] = (0, react.useState)(false);
			const [actionError, setActionError] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				let disposed = false;
				setRead({ busy: true });
				setSourceMode(false);
				setActionError("");
				if (!path) {
					setRead({ error: "文件地址不可用" });
					return;
				}
				previewFile(ownerSession, path).then((preview) => {
					if (!disposed && !tab.signal.aborted) setRead({ preview });
				}, (error) => {
					if (!disposed && !tab.signal.aborted) setRead({ error: error.message || String(error) });
				});
				return () => {
					disposed = true;
				};
			}, [
				ownerSession,
				path,
				tab.navigation.revision,
				tab.signal,
				retry
			]);
			const reveal = async () => {
				setActionError("");
				try {
					await revealFile(ownerSession, path);
				} catch (error) {
					setActionError(error.message || String(error));
				}
			};
			return h$1("section", {
				"data-eduwork-artifact-tab": "",
				"aria-label": `预览 ${path || ""}`,
				style: {
					height: "100%",
					minHeight: 0,
					display: "grid",
					gridTemplateRows: "auto minmax(0, 1fr)",
					color: "var(--dsw-alias-label-primary)",
					background: "var(--dsw-alias-bg-base)"
				}
			}, h$1("header", { style: {
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				gap: 6,
				padding: 10,
				borderBottom: "1px solid var(--dsw-alias-border-l2)"
			} }, h$1("span", {
				title: path,
				style: {
					flex: 1,
					minWidth: 60,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					fontSize: 12
				}
			}, path), read.preview?.encoding === "utf8" && ["md", "html"].includes(extension(path)) && h$1("button", {
				type: "button",
				style: button,
				onClick: () => setSourceMode((value) => !value)
			}, sourceMode ? "预览" : "源码"), h$1("button", {
				type: "button",
				style: button,
				onClick: reveal
			}, "定位"), read.preview?.downloadUrl && h$1("a", {
				href: read.preview.downloadUrl,
				download: basename(path),
				style: {
					...button,
					textDecoration: "none"
				}
			}, "下载"), h$1("button", {
				type: "button",
				style: button,
				onClick: () => setRetry((value) => value + 1),
				"aria-label": "刷新文件预览"
			}, "刷新"), actionError && h$1("p", {
				role: "alert",
				style: {
					width: "100%",
					margin: 0
				}
			}, actionError)), h$1("div", { style: {
				height: "100%",
				minHeight: 0,
				overflow: "hidden"
			} }, read.busy ? h$1("p", {
				role: "status",
				style: { padding: 20 }
			}, "正在读取预览…") : read.error ? h$1("div", { style: { padding: 20 } }, h$1("p", { role: "alert" }, read.error), h$1("button", {
				type: "button",
				style: button,
				onClick: () => setRetry((value) => value + 1)
			}, "重试")) : h$1(PreviewContent, {
				preview: read.preview,
				path,
				sourceMode
			})));
		}
		function installSidebarPreview(ctx, { previewFile, revealFile }) {
			const sidebar = ctx.get("sidebarRight");
			const tabs = ctx.get("sidebarRightTabs");
			if (!sidebar || !tabs) return void 0;
			ctx.effect(() => tabs.register(artifactTabDefinition), "eduwork: rendered file type");
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: id,
				inject: () => ({
					previewFile,
					revealFile
				})
			}, ArtifactTab)), "eduwork: shared file renderer");
			return (path, sessionId) => {
				sidebar.openResource(sessionFileAddress(sessionId, path));
				return true;
			};
		}
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"slots",
			"remote",
			"uiConversation",
			"layout"
		];
		const h = react.default.createElement;
		async function unwrap(operation) {
			const result = await operation;
			if (result?.ok === true) return result.value;
			throw new Error(result?.error?.message || result?.error?.code || "文件预览暂时不可用");
		}
		function metadata(block) {
			if (!("kind" in block) || block.meta === null || typeof block.meta !== "object") return null;
			const value = block.meta;
			if (typeof value.relativePath !== "string" || typeof value.mime !== "string") return null;
			return value;
		}
		function humanBytes(value) {
			if (!Number.isFinite(value) || value < 0) return "";
			if (value < 1024) return `${value} B`;
			if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
			return `${(value / 1024 / 1024).toFixed(1)} MB`;
		}
		const artifactProfiles = Object.freeze({
			image_generate: {
				title: "生成的图片",
				activity: "图片",
				icon: "图",
				kind: "image"
			},
			ecnu_image_generate: {
				title: "ChatECNU 图片",
				activity: "图片",
				icon: "图",
				kind: "image"
			},
			ecnu_tts_generate: {
				title: "ChatECNU 语音",
				activity: "语音",
				icon: "声",
				kind: "audio"
			},
			speech_synthesize: {
				title: "语音",
				activity: "语音",
				icon: "声",
				kind: "audio"
			},
			artifact_publish: {
				title: "生成的文件",
				activity: "文件",
				icon: "文",
				kind: "file"
			},
			office_document: {
				title: "Word 文档",
				activity: "Word 文档",
				icon: "W",
				kind: "office"
			},
			office_spreadsheet: {
				title: "Excel 工作簿",
				activity: "Excel 工作簿",
				icon: "X",
				kind: "office"
			},
			office_presentation: {
				title: "PowerPoint 演示文稿",
				activity: "PowerPoint 演示文稿",
				icon: "P",
				kind: "office"
			},
			office_pdf: {
				title: "PDF 文档",
				activity: "PDF 文档",
				icon: "PDF",
				kind: "office"
			}
		});
		const genericArtifactProfile = Object.freeze({
			title: "生成的文件",
			activity: "文件",
			icon: "文",
			kind: "file"
		});
		function profileFor(toolName, block, meta) {
			if ([
				"artifact_publish",
				"media_render",
				"video_project"
			].includes(toolName)) return artifactCardProfile(meta?.relativePath || artifactPathFromBlock(block), meta?.mime);
			return artifactProfiles[toolName] ?? genericArtifactProfile;
		}
		function MediaArtifactCard({ block, toolName, openFile, inspect, previewFile, openDetails, sessionId }) {
			const settled = "kind" in block;
			const meta = metadata(block);
			const failed = settled && block.isError;
			const profile = profileFor(toolName, block, meta);
			const image = profile.kind === "image";
			const video = profile.kind === "video";
			const title = profile.title;
			const details = meta === null ? "" : [
				image ? meta.size : video ? "" : meta.voice,
				!image && Number.isFinite(meta.speed) ? `${meta.speed}×` : "",
				humanBytes(meta.bytes)
			].filter(Boolean).join(" · ");
			const startPreview = () => {
				if (!meta) return;
				openArtifactPreview({
					sessionId,
					path: meta.relativePath,
					previewFile,
					openFile,
					openDetails
				});
			};
			return h(react.default.Fragment, null, h("article", {
				"data-chatecnu-media-artifact": profile.kind,
				style: {
					display: "grid",
					gridTemplateColumns: "44px minmax(0, 1fr) auto",
					alignItems: "center",
					gap: 11,
					minHeight: 66,
					margin: "3px 0",
					padding: "10px 12px",
					border: "1px solid var(--dsw-alias-border-l2)",
					borderRadius: 12,
					background: "var(--dsw-alias-bg-module-platform)",
					color: "var(--dsw-alias-label-primary)"
				}
			}, h("span", { style: {
				display: "grid",
				placeItems: "center",
				width: 42,
				height: 42,
				borderRadius: 10,
				background: "color-mix(in srgb, var(--chatecnu-logo-accent, #5157af) 12%, transparent)",
				color: "var(--chatecnu-logo-accent, #5157af)",
				fontSize: 20,
				fontWeight: 750
			} }, profile.icon), h("span", { style: { minWidth: 0 } }, h("strong", { style: {
				display: "block",
				fontSize: 13,
				lineHeight: 1.5
			} }, failed ? `${profile.activity}生成失败` : !settled ? `正在生成${profile.activity}…` : title), h("span", { style: {
				display: "block",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				color: failed ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-secondary)",
				fontSize: 12
			} }, meta?.relativePath || (failed ? "本次工具调用未生成文件" : "等待产物写入项目")), details && h("span", { style: {
				display: "block",
				marginTop: 2,
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 11
			} }, details)), h("span", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6
			} }, meta && !failed && h("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: startPreview,
				style: {
					border: "1px solid var(--dsw-alias-border-l2)",
					borderRadius: 8,
					padding: "5px 9px",
					background: "var(--dsw-alias-bg-base)",
					color: "var(--dsw-alias-label-primary)",
					cursor: "pointer",
					fontSize: 12
				}
			}, "预览"), meta && !failed && h("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: () => openFile(meta.relativePath),
				style: {
					border: "1px solid var(--dsw-alias-border-l2)",
					borderRadius: 8,
					padding: "5px 9px",
					background: "var(--dsw-alias-bg-base)",
					color: "var(--dsw-alias-label-primary)",
					cursor: "pointer",
					fontSize: 12
				}
			}, "打开"), inspect && h("button", {
				type: "button",
				"data-chatecnu-artifact-action": "",
				onClick: inspect,
				title: "查看工具详情",
				"aria-label": "查看工具详情",
				style: {
					border: 0,
					background: "transparent",
					color: "var(--dsw-alias-label-tertiary)",
					cursor: "pointer",
					fontSize: 17
				}
			}, "›"))));
		}
		async function apply(ctx) {
			const disposePreviewRemote = await ctx.remote.$mount(TYPERT_REMOTE);
			const style = document.createElement("style");
			style.dataset.chatecnuArtifactUx = "true";
			style.textContent = artifactInteractiveCss;
			document.head.append(style);
			const officialSidebar = typeof ctx.layout.openDetails !== "function";
			ctx.inject(["remote.artifactPreview", ...officialSidebar ? ["sidebarRight", "sidebarRightTabs"] : []], (surfaceCtx) => {
				const previewFile = (sessionId, relativePath) => {
					return unwrap(surfaceCtx.remote.artifactPreview.read(sessionId, relativePath));
				};
				const revealFile = (sessionId, relativePath) => unwrap(surfaceCtx.remote.artifactPreview.reveal(sessionId, relativePath));
				const openSidebar = installSidebarPreview(surfaceCtx, {
					previewFile,
					revealFile
				});
				const openDetails = openSidebar || (() => surfaceCtx.layout.openDetails());
				const importFiles = (sessionId, files) => unwrap(surfaceCtx.remote.artifactPreview.importFiles(sessionId, files));
				const importNativeFiles = (sessionId, grantID) => unwrap(surfaceCtx.remote.artifactPreview.importNativeFiles(sessionId, grantID));
				surfaceCtx.slots.inject("conversation.input.add", () => surfaceCtx.slots.register({
					name: "conversation.input.add",
					id: "chatecnu-workspace-file-input",
					inject: () => ({
						importFiles,
						importNativeFiles
					})
				}, WorkspaceFileInput));
				for (const key of Object.keys(artifactProfiles)) surfaceCtx.slots.inject("tool.call.toolview", () => surfaceCtx.slots.register({
					name: "tool.call.toolview",
					key,
					inject: () => ({
						previewFile,
						openDetails
					})
				}, MediaArtifactCard));
				if (!openSidebar) installDeliverables(surfaceCtx, {
					previewFile,
					revealFile,
					openDetails
				});
			});
			return () => {
				style.remove();
				disposePreviewRemote();
			};
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
