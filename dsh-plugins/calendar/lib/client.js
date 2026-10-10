window.__ModuleLoader__.load({
	id: "@eduwork/dsh-calendar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
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
		let react = require("react");
		react = __toESM(react, 1);
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		_deepseek_ai_dsh_client_ui_primitives = __toESM(_deepseek_ai_dsh_client_ui_primitives, 1);
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
		const boolean$1 = /^(?:true|false)$/i;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
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
		const version = {
			major: 4,
			minor: 4,
			patch: 3
		};
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
		const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = boolean$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Boolean(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "boolean") return payload;
				payload.issues.push({
					expected: "boolean",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
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
		const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!isPlainObject(input)) {
					payload.issues.push({
						expected: "record",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				const proms = [];
				const values = def.keyType._zod.values;
				if (values) {
					payload.value = {};
					const recordKeys = /* @__PURE__ */ new Set();
					for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
						recordKeys.add(typeof key === "number" ? key.toString() : key);
						const keyResult = def.keyType._zod.run({
							value: key,
							issues: []
						}, ctx);
						if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (keyResult.issues.length) {
							payload.issues.push({
								code: "invalid_key",
								origin: "record",
								issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
								input: key,
								path: [key],
								inst
							});
							continue;
						}
						const outKey = keyResult.value;
						const result = def.valueType._zod.run({
							value: input[key],
							issues: []
						}, ctx);
						if (result instanceof Promise) proms.push(result.then((result) => {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}));
						else {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}
					}
					let unrecognized;
					for (const key in input) if (!recordKeys.has(key)) {
						unrecognized = unrecognized ?? [];
						unrecognized.push(key);
					}
					if (unrecognized && unrecognized.length > 0) payload.issues.push({
						code: "unrecognized_keys",
						input,
						inst,
						keys: unrecognized
					});
				} else {
					payload.value = {};
					for (const key of Reflect.ownKeys(input)) {
						if (key === "__proto__") continue;
						if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
						let keyResult = def.keyType._zod.run({
							value: key,
							issues: []
						}, ctx);
						if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
							const retryResult = def.keyType._zod.run({
								value: Number(key),
								issues: []
							}, ctx);
							if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
							if (retryResult.issues.length === 0) keyResult = retryResult;
						}
						if (keyResult.issues.length) {
							if (def.mode === "loose") payload.value[key] = input[key];
							else payload.issues.push({
								code: "invalid_key",
								origin: "record",
								issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
								input: key,
								path: [key],
								inst
							});
							continue;
						}
						const result = def.valueType._zod.run({
							value: input[key],
							issues: []
						}, ctx);
						if (result instanceof Promise) proms.push(result.then((result) => {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[keyResult.value] = result.value;
						}));
						else {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[keyResult.value] = result.value;
						}
					}
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
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
		function _boolean(Class, params) {
			return new Class({
				type: "boolean",
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
		const booleanProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
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
		const recordProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			const keyType = def.keyType;
			const patterns = keyType._zod.bag?.patterns;
			if (def.mode === "loose" && patterns && patterns.size > 0) {
				const valueSchema = process(def.valueType, ctx, {
					...params,
					path: [
						...params.path,
						"patternProperties",
						"*"
					]
				});
				json.patternProperties = {};
				for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
			} else {
				if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process(def.keyType, ctx, {
					...params,
					path: [...params.path, "propertyNames"]
				});
				json.additionalProperties = process(def.valueType, ctx, {
					...params,
					path: [...params.path, "additionalProperties"]
				});
			}
			const keyValues = keyType._zod.values;
			if (keyValues) {
				const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
				if (validKeyValues.length > 0) json.required = validKeyValues;
			}
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
		const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
			$ZodBoolean.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
		});
		function boolean(params) {
			return /* @__PURE__ */ _boolean(ZodBoolean, params);
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
		const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
			$ZodRecord.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
			inst.keyType = def.keyType;
			inst.valueType = def.valueType;
		});
		function record(keyType, valueType, params) {
			if (!valueType || !valueType._zod) return new ZodRecord({
				type: "record",
				keyType: string(),
				valueType: keyType,
				...normalizeParams(valueType)
			});
			return new ZodRecord({
				type: "record",
				keyType,
				valueType,
				...normalizeParams(params)
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
		/** Local time string: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` where a clock applies. */
		const LocalTimeSchema = string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "expected YYYY-MM-DD or YYYY-MM-DDTHH:mm");
		/**
		* Supported recurrence subset. Deliberately narrower than RRULE: rules outside
		* it (monthly, yearly, BYMONTHDAY, BYSETPOS) are not represented here — the
		* importer keeps their original RRULE text in `extensions` and degrades the
		* event to a single occurrence instead of dropping it silently.
		*/
		const RecurrenceSchema = object({
			freq: literal("weekly"),
			interval: number().int().positive().optional(),
			count: number().int().positive().optional(),
			until: LocalTimeSchema.optional(),
			byDay: array(_enum([
				"mo",
				"tu",
				"we",
				"th",
				"fr",
				"sa",
				"su"
			])).optional()
		}).strict();
		const OverridesSchema = array(object({
			date: string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
			title: string().min(1).optional(),
			start: LocalTimeSchema.optional(),
			end: LocalTimeSchema.optional(),
			location: string().optional(),
			description: string().optional()
		}).strict().refine((value) => Object.keys(value).length > 1, "an override must change at least one field")).refine((list) => new Set(list.map((entry) => entry.date)).size === list.length, "each date may be overridden once");
		/**
		* Fields every event-shaped value carries — the stored record and the
		* occurrence handed to a view. Shared so the two cannot drift apart.
		*/
		const EventFields = {
			uid: string().min(1),
			title: string().min(1),
			start: LocalTimeSchema,
			end: LocalTimeSchema.optional(),
			location: string().optional(),
			description: string().optional(),
			recurrence: RecurrenceSchema.optional(),
			source: string().optional(),
			extensions: record(string(), unknown()).optional()
		};
		/** Durable shape of one event: the shared fields plus series bookkeeping. */
		const EventSchema = object({
			...EventFields,
			exceptions: array(LocalTimeSchema).optional(),
			overrides: OverridesSchema.optional()
		}).strict();
		EventSchema.extend(Object.fromEntries(["courseId"].map((field) => [field, unknown().optional()])));
		const snapshot = object({
			schemaVersion: number().int().positive(),
			events: array(EventSchema)
		}).strict();
		const occurrence = object({
			...EventFields,
			occurrenceId: string().min(1),
			occurrenceDate: string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
			overridden: boolean().optional()
		}).strict();
		const occurrences = object({
			schemaVersion: number().int().positive(),
			occurrences: array(occurrence)
		}).strict();
		/** Bounds of a range query; either side may be omitted. */
		const rangeSchema = object({
			from: LocalTimeSchema.optional(),
			to: LocalTimeSchema.optional()
		}).strict();
		/** A day of a series, as the occurrence itself names it. */
		const dateSchema = string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
		/** Calendar text to import, and how it should land. */
		const importInput = object({
			text: string().min(1),
			source: string().min(1).optional(),
			replace: boolean().optional()
		}).strict();
		/** What an import wrote, what it removed, and what it could not use. */
		const importOutcome = object({
			events: number().int().nonnegative(),
			removedEvents: number().int().nonnegative(),
			skipped: array(object({
				uid: string().optional(),
				reason: string()
			}).strict()),
			degraded: array(object({
				uid: string().optional(),
				reason: string().optional(),
				rrule: string().optional()
			}).strict())
		}).strict();
		/** What to call the exported calendar. */
		const exportInput = object({ name: string().min(1).optional() }).strict();
		const exportOutcome = object({ text: string() }).strict();
		/** One date of one series. */
		const occurrenceInput = object({
			uid: string().min(1),
			date: dateSchema
		}).strict();
		/** The changeable fields of one occurrence; `date` is the series' own date. */
		const overrideInput = object({
			uid: string().min(1),
			date: dateSchema,
			patch: object({
				title: string().min(1).optional(),
				start: LocalTimeSchema.optional(),
				end: LocalTimeSchema.optional(),
				location: string().optional(),
				description: string().optional()
			}).strict()
		}).strict();
		const uidInput = object({ uid: string().min(1) }).strict();
		const removalOutcome = object({ removed: boolean() }).strict();
		/** Wrap a zod schema in the descriptor shape the gateway reads. */
		const result = (typeSymbol, schema) => Object.freeze({
			mode: "strict",
			create() {
				return this.schema;
			},
			typeSymbol,
			schema
		});
		/** One JSON argument of one remote method, named the way the method reads it. */
		const jsonParameter = (method, name, schema) => Object.freeze({
			name,
			wire: name,
			source: "json",
			codec: Object.freeze({
				mode: "strict",
				create() {
					return this.schema;
				},
				typeSymbol: `@eduwork/dsh-calendar#calendar/${method}:${name}`,
				schema
			})
		});
		const rangeParameter = jsonParameter("occurrences", "range", rangeSchema);
		const importParameter = jsonParameter("importIcs", "input", importInput);
		const exportParameter = jsonParameter("exportIcs", "options", exportInput);
		const overrideParameter = jsonParameter("applyOverride", "input", overrideInput);
		const removeOverrideParameter = jsonParameter("removeOverride", "input", occurrenceInput);
		const cancelParameter = jsonParameter("cancelOccurrence", "input", occurrenceInput);
		const restoreParameter = jsonParameter("restoreOccurrence", "input", occurrenceInput);
		const deleteEventParameter = jsonParameter("deleteEvent", "input", uidInput);
		const eventParameter = jsonParameter("putEvent", "event", EventSchema);
		const snapshotResult = result("@eduwork/dsh-calendar#CalendarSnapshot", snapshot);
		const occurrencesResult = result("@eduwork/dsh-calendar#CalendarOccurrences", occurrences);
		const importResult = result("@eduwork/dsh-calendar#CalendarImport", importOutcome);
		const exportResult = result("@eduwork/dsh-calendar#CalendarExport", exportOutcome);
		const eventResult = result("@eduwork/dsh-calendar#CalendarEvent", EventSchema);
		const removalResult = result("@eduwork/dsh-calendar#CalendarRemoval", removalOutcome);
		const pkg = "@eduwork/dsh-calendar";
		/**
		* @param method - Method name, which is also the service's own method name.
		* @param line - Line of the method in `lib/index.js`.
		* @param parameters - One entry per argument, in call order.
		* @param result - Result type of the method.
		* @returns a frozen descriptor.
		*/
		const descriptor = (method, line, parameters, result) => Object.freeze({
			id: `${pkg}#calendar/${method}`,
			service: "calendar",
			namespace: "calendar",
			method,
			invocation: { kind: "direct" },
			parameters: Object.freeze(parameters),
			result,
			sourceLocation: {
				file: "dsh-plugins/calendar/lib/index.js",
				line,
				column: 3
			}
		});
		var typert_remote_client_default = {
			package: "@eduwork/dsh-calendar",
			descriptors: Object.freeze([
				descriptor("snapshot", 47, [], snapshotResult),
				descriptor("occurrences", 66, [rangeParameter], occurrencesResult),
				descriptor("importIcs", 82, [importParameter], importResult),
				descriptor("exportIcs", 94, [exportParameter], exportResult),
				descriptor("deleteEvent", 123, [deleteEventParameter], removalResult),
				descriptor("applyOverride", 133, [overrideParameter], eventResult),
				descriptor("removeOverride", 142, [removeOverrideParameter], eventResult),
				descriptor("cancelOccurrence", 151, [cancelParameter], eventResult),
				descriptor("restoreOccurrence", 160, [restoreParameter], eventResult),
				descriptor("putEvent", 114, [eventParameter], eventResult)
			])
		};
		/** Minutes in a whole day; also the exclusive upper bound of the axis. */
		const MINUTES_IN_DAY = 1440;
		const pad2$1 = (value) => String(value).padStart(2, "0");
		/** Local midnight of a `YYYY-MM-DD` date. */
		function parseDay(date) {
			const [year, month, day] = date.split("-").map(Number);
			return new Date(year, month - 1, day);
		}
		/** Whole days from one local date to another. */
		function dayGap(from, to) {
			return Math.round((parseDay(to) - parseDay(from)) / 864e5);
		}
		/** The local `YYYY-MM-DD` date `days` away. */
		function shiftDay(date, days) {
			const value = parseDay(date);
			value.setDate(value.getDate() + days);
			return `${value.getFullYear()}-${pad2$1(value.getMonth() + 1)}-${pad2$1(value.getDate())}`;
		}
		/**
		* Minutes from local midnight of a local time string.
		* @param value - `YYYY-MM-DDTHH:mm`, or anything else.
		* @returns minutes in `[0, 1440)`, or `undefined` when the value carries no clock.
		*/
		function minutesOf(value) {
			if (typeof value !== "string" || value.length < 16) return void 0;
			const hours = Number(value.slice(11, 13));
			const minutes = Number(value.slice(14, 16));
			if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return void 0;
			if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return void 0;
			return hours * 60 + minutes;
		}
		/**
		* The end that keeps an entry's length when only its start moved.
		*
		* An edit form that opens with both fields filled hands back an end that never
		* moved, so saving a new start on its own would keep the old clock time and can
		* finish before it begins. Carrying the span instead keeps a 90-minute entry 90
		* minutes long, and follows a start that crosses into another day.
		* @param start - New local start, `YYYY-MM-DDTHH:mm`.
		* @param from - Start the entry had.
		* @param to - End the entry had.
		* @returns Local end that keeps `to - from`, or `undefined` when a value has no clock.
		*/
		function shiftedEnd(start, from, to) {
			const startMinutes = minutesOf(start);
			const fromMinutes = minutesOf(from);
			const toMinutes = minutesOf(to);
			if (startMinutes === void 0 || fromMinutes === void 0 || toMinutes === void 0) return void 0;
			const at = startMinutes + (dayGap(from.slice(0, 10), to.slice(0, 10)) * MINUTES_IN_DAY + (toMinutes - fromMinutes));
			const date = shiftDay(start.slice(0, 10), Math.floor(at / MINUTES_IN_DAY));
			const clock = (at % MINUTES_IN_DAY + MINUTES_IN_DAY) % MINUTES_IN_DAY;
			return `${date}T${pad2$1(Math.floor(clock / 60))}:${pad2$1(clock % 60)}`;
		}
		/**
		* Vertical bounds of the axis, in minutes.
		*
		* The default working day is always visible and the data may widen it, padded by
		* half an hour and rounded out to whole hours. Padding only applies to a side the
		* data actually leaves, so a week whose first lesson is at 08:00 still starts at
		* 08:00 instead of drifting to 07:00 to make room for padding it does not need.
		* Keeping a floor means the axis does not jump between weeks while the reader is
		* stepping through them.
		* @param occurrences - Occurrences of the visible days; whole-day ones carry no clock to place.
		* @param options - `from`/`to` are the guaranteed bounds, `pad` the slack, `step` the rounding.
		* @returns `{ start, end }` in minutes, `start < end`.
		*/
		function dayWindow(occurrences, options = {}) {
			const from = options.from ?? 480;
			const to = options.to ?? 1200;
			const pad = options.pad ?? 30;
			const step = options.step ?? 60;
			let first = Infinity;
			let last = -Infinity;
			for (const occurrence of occurrences ?? []) {
				const start = minutesOf(occurrence?.start);
				if (start === void 0) continue;
				const end = minutesOf(occurrence?.end) ?? start + 45;
				first = Math.min(first, start);
				last = Math.max(last, end);
			}
			if (!Number.isFinite(first)) return {
				start: from,
				end: to
			};
			return {
				start: first < from ? Math.max(0, floorTo(first - pad, step)) : from,
				end: last > to ? Math.min(MINUTES_IN_DAY, ceilTo(last + pad, step)) : to
			};
		}
		/** Round down to a `step` grid, counting from midnight. */
		function floorTo(minutes, step) {
			return Math.floor(minutes / step) * step;
		}
		/** Round up to a `step` grid, counting from midnight. */
		function ceilTo(minutes, step) {
			return Math.ceil(minutes / step) * step;
		}
		/**
		* Place one day's timed occurrences.
		*
		* Blocks that overlap form a cluster and split the day's width between them;
		* a block starting no earlier than the last end of the current cluster opens a
		* new one and gets the full width, which is what keeps back-to-back lessons
		* readable. Lanes inside a cluster are assigned greedily: a block takes the
		* first lane free at its start.
		* @param occurrences - Occurrences of one day; entries without a clock are skipped.
		* @param options - `minHeight` keeps a very short block clickable, in minutes.
		* @returns one entry per timed occurrence, in start order, as
		*   `{ occurrence, start, end, top, height, lane, lanes }` in minutes.
		*/
		function layoutDay(occurrences, options = {}) {
			const minHeight = options.minHeight ?? 22;
			const items = [];
			for (const occurrence of occurrences ?? []) {
				const start = minutesOf(occurrence?.start);
				if (start === void 0) continue;
				const rawEnd = minutesOf(occurrence?.end);
				const end = rawEnd === void 0 ? start + 45 : rawEnd > start ? rawEnd : rawEnd < start ? MINUTES_IN_DAY : start + 1;
				items.push({
					occurrence,
					start,
					end,
					lane: 0
				});
			}
			items.sort((left, right) => left.start - right.start || right.end - left.end || String(left.occurrence?.occurrenceId ?? "").localeCompare(String(right.occurrence?.occurrenceId ?? "")));
			const placed = [];
			let cluster = [];
			let clusterEnd = -Infinity;
			const close = () => {
				if (cluster.length === 0) return;
				const laneEnds = [];
				for (const item of cluster) {
					let lane = laneEnds.findIndex((end) => end <= item.start);
					if (lane === -1) {
						lane = laneEnds.length;
						laneEnds.push(item.end);
					} else laneEnds[lane] = item.end;
					item.lane = lane;
				}
				for (const item of cluster) placed.push({
					occurrence: item.occurrence,
					start: item.start,
					end: item.end,
					top: item.start,
					height: Math.max(minHeight, item.end - item.start),
					lane: item.lane,
					lanes: laneEnds.length
				});
				cluster = [];
			};
			for (const item of items) {
				if (cluster.length > 0 && item.start >= clusterEnd) close();
				cluster.push(item);
				clusterEnd = cluster.length === 1 ? item.end : Math.max(clusterEnd, item.end);
			}
			close();
			return placed;
		}
		/**
		* Place a whole week, one day at a time.
		*
		* The date is part of a block's identity: two lessons that both start at 08:00
		* but fall on different weekdays are not in conflict and must not share lanes.
		* Callers hand in whatever the range query returned, so the grouping happens
		* here instead of being something every caller has to remember to do.
		* @param occurrences - Occurrences of the visible days.
		* @param options - forwarded to `layoutDay`.
		* @returns a `Map` from `YYYY-MM-DD` to that day's placed entries.
		*/
		function layoutWeek(occurrences, options = {}) {
			const days = /* @__PURE__ */ new Map();
			for (const occurrence of occurrences ?? []) {
				const date = String(occurrence?.start ?? "").slice(0, 10);
				if (date.length !== 10) continue;
				const list = days.get(date);
				if (list) list.push(occurrence);
				else days.set(date, [occurrence]);
			}
			const placed = /* @__PURE__ */ new Map();
			for (const [date, list] of days) placed.set(date, layoutDay(list, options));
			return placed;
		}
		/**
		* Resolve one icon from the loaded primitives package.
		* @param names - the names it may be exported under, older generation first.
		* @param size - the size to draw at when the name does not already fix it.
		*/
		const icon = (names, size) => {
			const artwork = names.map((name) => _deepseek_ai_dsh_client_ui_primitives[name]).find(Boolean);
			return artwork ? (props = {}) => react.default.createElement(artwork, {
				size,
				...props
			}) : () => null;
		};
		const IconAlarmClock = icon(["IconAlarmClockOutline16", "IconAlarmClockOutlineRegular"], 16);
		const IconArchive = icon(["IconArchiveOutline20", "IconArchiveOutlineRegular"], 20);
		const IconCheck = icon(["IconCheckOutline16", "IconCheckOutlineRegular"], 16);
		const IconChevronDown = icon(["IconChevronDownOutline14", "IconChevronDownOutlineRegular"], 14);
		const IconChevronLeft = icon(["IconChevronLeftOutline14", "IconChevronLeftOutlineRegular"], 14);
		const IconChevronRight = icon(["IconChevronRightOutline14", "IconChevronRightOutlineRegular"], 14);
		const IconClock = icon(["IconClockOutline16", "IconClockOutlineRegular"], 16);
		const IconCopy = icon(["IconCopyOutline16", "IconCopyOutlineRegular"], 16);
		const IconDownload = icon(["IconDownloadOutline16", "IconDownloadOutlineRegular"], 16);
		const IconFolderOpen = icon(["IconFolderOpenOutline16", "IconFolderOpenOutlineRegular"], 16);
		const IconPlus = icon(["IconPlusOutline16", "IconPlusOutlineRegular"], 16);
		const IconRefresh = icon(["IconRefreshOutline16", "IconRefreshOutlineRegular"], 16);
		const IconRefreshSmall = icon(["IconRefreshOutline14", "IconRefreshOutlineRegular"], 14);
		const IconTrash = icon(["IconTrashOutline16", "IconTrashOutlineRegular"], 16);
		const IconWarning = icon(["IconWarningOutline16", "IconWarningOutlineRegular"], 16);
		const inject = ["slots", "remote"];
		const PANEL_ID = "calendar";
		const WEEKDAYS = [
			"周一",
			"周二",
			"周三",
			"周四",
			"周五",
			"周六",
			"周日"
		];
		/** Recurrence weekday codes, for the summary line of a stored series. */
		const WEEKDAY_BY_CODE = {
			mo: "周一",
			tu: "周二",
			we: "周三",
			th: "周四",
			fr: "周五",
			sa: "周六",
			su: "周日"
		};
		/** Source an import writes unless the reader says otherwise; the scope that is replaced. */
		const DEFAULT_SOURCE = "ics";
		/**
		* The `uid` of an entry created here. The caller owns it — the host stores the
		* record it is handed — so it has to be one no import would ever produce.
		*/
		const newUid = () => globalThis.crypto?.randomUUID ? `manual-${globalThis.crypto.randomUUID()}` : `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		const PX_PER_MINUTE = 48 / 60;
		/** Width of the hour gutter, in pixels. */
		const GUTTER = 54;
		/**
		* The axis is a whole day, as in the calendars this view follows. A fixed
		* working day left the lower half of a tall window empty; with the whole day on
		* the axis the grid always reaches the bottom, and the view scrolls to where
		* this week's entries are instead of cropping them to office hours.
		*/
		const DAY_MINUTES = 1440;
		const PAGE_BACKGROUND = "var(--dsw-alias-bg-base, #fff)";
		const PRIMARY = "var(--dsw-alias-label-primary, #222)";
		const SECONDARY = "var(--dsw-alias-label-secondary, #666)";
		const TERTIARY = "var(--dsw-alias-label-tertiary, #888)";
		const HAIRLINE = ".5px solid var(--dsw-alias-border-l1, #00000014)";
		const CARD_BORDER = "1px solid var(--dsw-alias-border-l2, #0000001f)";
		const LAYER = "var(--dsw-alias-bg-layer-2, #f6f6f6)";
		const HOVER = "var(--dsw-alias-interactive-bg-hover, #0000000a)";
		/** The hues a source is drawn in, as the product's static palette names; the fallbacks are for themes without them. */
		const TINTS = {
			blue: "#4d6bfe",
			amber: "#d99a2b",
			green: "#2f9e68",
			deepseek: "#4d6bfe",
			red: "#d4553f"
		};
		const TINT_FAMILIES = Object.keys(TINTS);
		/** Hover feedback for a row or a block, which inline styles cannot express. */
		function useHover() {
			const [hovered, setHovered] = (0, react.useState)(false);
			return [hovered, {
				onMouseEnter: () => setHovered(true),
				onMouseLeave: () => setHovered(false)
			}];
		}
		const pad2 = (value) => String(value).padStart(2, "0");
		/** Local `YYYY-MM-DD` of a date. */
		const localDate = (value = /* @__PURE__ */ new Date()) => `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
		/** Local midnight of a `YYYY-MM-DD` string. */
		function parseDate(date) {
			const [year, month, day] = date.split("-").map(Number);
			return new Date(year, month - 1, day);
		}
		const addDays = (date, days) => {
			const value = parseDate(date);
			value.setDate(value.getDate() + days);
			return localDate(value);
		};
		/** Monday of the week a date belongs to. */
		const startOfWeek = (date = localDate()) => addDays(date, -((parseDate(date).getDay() + 6) % 7));
		const dateOf = (value) => value.slice(0, 10);
		/** Clock part of a local time string, empty for a whole-day value. */
		const clockOf = (value) => value && value.length > 10 ? value.slice(11, 16) : "";
		const weekdayOf = (date) => WEEKDAYS[(parseDate(date).getDay() + 6) % 7];
		const dayNumber = (date) => parseDate(date).getDate();
		const shortDate = (date) => `${parseDate(date).getMonth() + 1}月${parseDate(date).getDate()}日`;
		const monthOf = (date) => `${parseDate(date).getFullYear()}年${parseDate(date).getMonth() + 1}月`;
		const hourLabel = (minutes) => `${pad2(Math.floor(minutes / 60))}:00`;
		/** Minutes from midnight of an `HH:mm` clock string. */
		const clockMinutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
		/** The `HH:mm` clock string of minutes from midnight. */
		const clockAt = (minutes) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
		const isToday = (date) => date === localDate();
		/**
		* The clock a new entry is offered: the next whole hour when it is for today,
		* otherwise the start of a working day. A new entry therefore always carries a
		* time, and nothing is written as a whole-day record by accident.
		*/
		function suggestedStart(date) {
			if (date !== localDate()) return 540;
			const now = /* @__PURE__ */ new Date();
			return Math.min(1320, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 60) * 60);
		}
		/** The clock range a block shows, from its own times. */
		function clockRange(occurrence) {
			const start = clockOf(occurrence?.start);
			const end = clockOf(occurrence?.end);
			if (start === "") return "全天";
			return end === "" ? start : `${start}–${end}`;
		}
		/** A stable hue per data source, so one import keeps its colour across views and restarts. */
		function tintOf(key) {
			let hash = 0;
			const text = key ?? "event";
			for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 100003;
			const family = TINT_FAMILIES[hash % TINT_FAMILIES.length];
			const accent = `var(--dsw-static-${family}-500, ${TINTS[family]})`;
			return {
				accent,
				background: `color-mix(in srgb, ${accent} 15%, var(--dsw-alias-bg-layer-1, #fff))`
			};
		}
		/** Drop undefined and blank entries, so a patch or an edit carries only what it means. */
		function withoutEmpty(input) {
			const output = {};
			for (const [key, value] of Object.entries(input)) {
				if (value === void 0 || value === null) continue;
				if (typeof value === "string" && value.trim() === "") continue;
				output[key] = value;
			}
			return output;
		}
		const messageOf = (error) => error instanceof Error ? error.message : String(error);
		/** Unwrap one remote result: the gateway answers with `{ ok, value }` or `{ ok, error }`. */
		async function unwrap(operation) {
			const result = await operation;
			if (result?.ok === true) return result.value;
			throw new Error(result?.error?.message || result?.error?.code || "日历数据不可用");
		}
		/** The note of a record: a field of its own, written out as `DESCRIPTION`. */
		const noteOf = (event) => typeof event?.description === "string" ? event.description : "";
		/** One line describing how often a stored series repeats. */
		function seriesSummary(event) {
			if (!event.recurrence) return "单次";
			const days = (event.recurrence.byDay ?? []).map((code) => WEEKDAY_BY_CODE[code]).filter(Boolean).join("、");
			const interval = event.recurrence.interval;
			const every = interval && interval > 1 ? `每 ${interval} 周` : "每周";
			const limit = event.recurrence.count ? ` · 共 ${event.recurrence.count} 次` : event.recurrence.until ? ` · 至 ${shortDate(dateOf(event.recurrence.until))}` : "";
			return `${every}${days ? ` ${days}` : ""}${limit}`;
		}
		/** A labelled form row: the label above its control, as in the shell's own settings. */
		function Field({ label, children, hint }) {
			return react.default.createElement("label", { style: {
				display: "block",
				marginBottom: 12
			} }, react.default.createElement("span", { style: {
				display: "block",
				marginBottom: 6,
				fontSize: 12,
				color: SECONDARY
			} }, label), children, hint ? react.default.createElement("span", { style: {
				display: "block",
				marginTop: 4,
				fontSize: 11,
				color: TERTIARY
			} }, hint) : void 0);
		}
		const Muted = ({ children, style }) => react.default.createElement("span", { style: {
			fontSize: 12,
			color: SECONDARY,
			...style
		} }, children);
		/** Icon-only button with the product's tooltip, used for every row-level action. */
		function IconButton({ label, icon, onClick, danger, disabled }) {
			return react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label,
				side: "bottom"
			}, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				icon,
				onClick,
				disabled,
				"aria-label": label,
				style: danger ? { color: "var(--dsw-alias-state-error-primary, #d4553f)" } : void 0
			}));
		}
		/**
		* One entry on the axis.
		*
		* The block is a button so a keyboard reaches it, and its width is the lane the
		* layout gave it: `100 / lanes` percent, inset by a hairline so neighbours stay
		* apart.
		*/
		function Block({ entry, axisStart, tint, onSelect }) {
			const [hovered, hover] = useHover();
			const width = 100 / entry.lanes;
			const height = entry.height * PX_PER_MINUTE;
			const inner = height - 8;
			const label = `${clockRange(entry.occurrence)} ${entry.occurrence.title}${entry.occurrence.location ? ` · ${entry.occurrence.location}` : ""}`;
			const line = {
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis"
			};
			return react.default.createElement("button", {
				type: "button",
				title: label,
				"aria-label": label,
				onClick: () => onSelect(entry.occurrence),
				...hover,
				style: {
					position: "absolute",
					top: (entry.top - axisStart) * PX_PER_MINUTE,
					height,
					left: `calc(${entry.lane * width}% + 2px)`,
					width: `calc(${width}% - 4px)`,
					display: "block",
					overflow: "hidden",
					textAlign: "left",
					cursor: "pointer",
					padding: "3px 6px",
					border: "none",
					borderLeft: `3px solid ${tint.accent}`,
					borderRadius: 6,
					background: tint.background,
					color: PRIMARY,
					fontFamily: "inherit",
					boxShadow: hovered ? "var(--dsw-elevation-panel, 0 6px 18px rgba(0, 0, 0, .16))" : "none",
					transition: "box-shadow .12s ease",
					zIndex: hovered ? 2 : 1
				}
			}, react.default.createElement("div", { style: {
				...line,
				fontSize: 11,
				lineHeight: "15px",
				color: SECONDARY,
				fontVariantNumeric: "tabular-nums"
			} }, clockRange(entry.occurrence)), react.default.createElement("div", { style: {
				...line,
				marginTop: 1,
				fontSize: 12,
				lineHeight: "17px",
				fontWeight: 600
			} }, entry.occurrence.title), inner >= 34 && entry.occurrence.location ? react.default.createElement("div", { style: {
				...line,
				fontSize: 11,
				lineHeight: "15px",
				color: SECONDARY
			} }, entry.occurrence.location) : void 0);
		}
		/**
		* The week: a day header row and the hour axis below it. The axis is one scroll
		* container so the day columns can never drift apart vertically. A record that
		* arrives without a clock is drawn as a block at midnight, not in a row of its
		* own, so the week has a single geometry.
		*
		* Dragging on an empty spot starts an entry spanning what was dragged, and a
		* double click starts a one-hour one there: between them the view is writable
		* rather than only readable.
		*/
		function WeekGrid({ anchor, occurrences, onSelect, onCreate }) {
			const [now, setNow] = (0, react.useState)(() => /* @__PURE__ */ new Date());
			(0, react.useEffect)(() => {
				const timer = setInterval(() => setNow(/* @__PURE__ */ new Date()), 6e4);
				return () => clearInterval(timer);
			}, []);
			const days = (0, react.useMemo)(() => Array.from({ length: 7 }, (_, index) => {
				const date = addDays(anchor, index);
				return {
					key: date,
					label: WEEKDAYS[index],
					day: dayNumber(date),
					today: isToday(date)
				};
			}), [anchor]);
			const focus = (0, react.useMemo)(() => dayWindow(occurrences).start, [occurrences]);
			const scroller = (0, react.useRef)(null);
			const scrolledTo = (0, react.useRef)("");
			(0, react.useEffect)(() => {
				const node = scroller.current;
				const key = `${anchor}:${focus}`;
				if (!node || scrolledTo.current === key) return;
				scrolledTo.current = key;
				node.scrollTop = Math.max(0, focus * PX_PER_MINUTE - 8);
			}, [anchor, focus]);
			const axis = (0, react.useMemo)(() => ({
				start: 0,
				end: DAY_MINUTES
			}), []);
			const hours = (0, react.useMemo)(() => {
				const list = [];
				for (let minutes = axis.start; minutes < axis.end; minutes += 60) list.push(minutes);
				return list;
			}, [axis]);
			const axisHeight = (axis.end - axis.start) * PX_PER_MINUTE;
			const [dragging, setDragging] = (0, react.useState)(null);
			const press = (0, react.useRef)(null);
			/** The fifteen-minute slot under a pointer inside one column. */
			const slotAt = (event) => {
				const box = event.currentTarget.getBoundingClientRect();
				const raw = axis.start + (event.clientY - box.top) / PX_PER_MINUTE;
				return Math.max(0, Math.min(DAY_MINUTES - 15, Math.round(raw / 15) * 15));
			};
			const timed = (0, react.useMemo)(() => (occurrences ?? []).filter((occurrence) => clockOf(occurrence.start) !== ""), [occurrences]);
			const byDay = (0, react.useMemo)(() => layoutWeek(timed), [timed]);
			/**
			* Whole-day occurrences, listed under every day of this week they cover.
			*
			* A value that arrived without a clock (`DTSTART;VALUE=DATE`, which is what a
			* holiday or an academic calendar is made of) has no slot on the axis, so it is
			* shown in the day header: visible whatever the axis is scrolled to, and not
			* claiming a time it does not have. A record that covers several days is shown
			* on each of them, the way a calendar draws a multi-day bar.
			*/
			const allDayByDay = (0, react.useMemo)(() => {
				const first = anchor;
				const last = addDays(anchor, 6);
				const map = /* @__PURE__ */ new Map();
				for (const occurrence of occurrences ?? []) {
					if (clockOf(occurrence.start) !== "") continue;
					const start = dateOf(occurrence.start);
					const spanned = occurrence.end && clockOf(occurrence.end) === "" && dateOf(occurrence.end) > start ? dateOf(occurrence.end) : start;
					const from = start < first ? first : start;
					const to = spanned > last ? last : spanned;
					for (let date = from; date <= to; date = addDays(date, 1)) {
						const list = map.get(date);
						if (list) list.push(occurrence);
						else map.set(date, [occurrence]);
					}
				}
				return map;
			}, [occurrences, anchor]);
			const nowMinutes = now.getHours() * 60 + now.getMinutes();
			const nowVisible = days.some((day) => day.today);
			/** The whole-day entries of one day, as the chips its header shows. */
			const allDayChips = (date) => {
				const list = allDayByDay.get(date) ?? [];
				if (list.length === 0) return void 0;
				return react.default.createElement("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: 2,
					marginTop: 4
				} }, ...list.slice(0, 2).map((occurrence) => {
					const tint = tintOf(occurrence.source ?? occurrence.uid);
					const label = `全天 · ${occurrence.end && dateOf(occurrence.end) > dateOf(occurrence.start) ? `${shortDate(dateOf(occurrence.start))}–${shortDate(dateOf(occurrence.end))}` : shortDate(dateOf(occurrence.start))} ${occurrence.title}`;
					return react.default.createElement("button", {
						key: occurrence.occurrenceId,
						type: "button",
						title: label,
						"aria-label": label,
						onClick: () => onSelect(occurrence),
						style: {
							display: "block",
							width: "100%",
							padding: "1px 4px",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
							textAlign: "left",
							fontSize: 10,
							lineHeight: "15px",
							fontFamily: "inherit",
							color: PRIMARY,
							background: tint.background,
							borderLeft: `3px solid ${tint.accent}`,
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis"
						}
					}, occurrence.title);
				}), list.length > 2 ? react.default.createElement("div", { style: {
					fontSize: 10,
					lineHeight: "14px",
					color: SECONDARY,
					textAlign: "left"
				} }, `还有 ${list.length - 2} 条全天`) : void 0);
			};
			const headerRow = react.default.createElement("div", { style: {
				display: "flex",
				borderBottom: CARD_BORDER,
				background: PAGE_BACKGROUND,
				paddingRight: 8
			} }, react.default.createElement("div", { style: {
				width: GUTTER,
				flex: "0 0 auto"
			} }), ...days.map((day) => react.default.createElement("div", {
				key: day.key,
				style: {
					flex: "1 1 0",
					minWidth: 0,
					padding: "8px 4px",
					textAlign: "center",
					borderLeft: HAIRLINE
				}
			}, react.default.createElement("div", { style: {
				fontSize: 11,
				color: day.today ? PRIMARY : SECONDARY
			} }, day.label), react.default.createElement("div", { style: day.today ? {
				width: 26,
				height: 26,
				margin: "2px auto 0",
				borderRadius: 999,
				lineHeight: "26px",
				fontSize: 13,
				fontWeight: 650,
				background: "var(--dsw-alias-state-business-primary, #4d6bfe)",
				color: "#fff"
			} : {
				marginTop: 2,
				fontSize: 13,
				fontWeight: 600,
				lineHeight: "26px",
				color: PRIMARY
			} }, day.day), allDayChips(day.key))));
			const hourLabels = hours.map((minutes, index) => react.default.createElement("div", {
				key: minutes,
				style: {
					position: "absolute",
					top: index === 0 ? 2 : (minutes - axis.start) * PX_PER_MINUTE - 6,
					right: 8,
					fontSize: 11,
					color: TERTIARY,
					fontVariantNumeric: "tabular-nums"
				}
			}, hourLabel(minutes)));
			const columns = days.map((day) => react.default.createElement("div", {
				key: day.key,
				onPointerDown: (event) => {
					if (!onCreate || event.target !== event.currentTarget) return;
					if (event.pointerType === "touch" || event.button !== 0) return;
					const from = slotAt(event);
					press.current = {
						day: day.key,
						from,
						pointerId: event.pointerId,
						moved: false
					};
					event.currentTarget.setPointerCapture(event.pointerId);
					setDragging({
						day: day.key,
						from,
						to: from
					});
					event.preventDefault();
				},
				onPointerMove: (event) => {
					const active = press.current;
					if (!active || active.pointerId !== event.pointerId) return;
					const to = slotAt(event);
					if (!active.moved && Math.abs(to - active.from) < 15) return;
					active.moved = true;
					setDragging({
						day: active.day,
						from: Math.min(active.from, to),
						to: Math.max(active.from, to)
					});
				},
				onPointerUp: (event) => {
					const active = press.current;
					if (!active || active.pointerId !== event.pointerId) return;
					press.current = null;
					setDragging(null);
					if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
					if (!active.moved) return;
					const to = slotAt(event);
					if (Math.abs(to - active.from) < 15) return;
					onCreate(day.key, Math.min(active.from, to), Math.max(active.from, to));
				},
				onPointerCancel: (event) => {
					if (press.current?.pointerId !== event.pointerId) return;
					press.current = null;
					setDragging(null);
				},
				onDoubleClick: (event) => {
					if (!onCreate || event.target !== event.currentTarget) return;
					const from = slotAt(event);
					onCreate(day.key, from, Math.min(from + 60, 1439));
				},
				style: {
					position: "relative",
					flex: "1 1 0",
					minWidth: 0,
					borderLeft: HAIRLINE,
					background: day.today ? "color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 4%, transparent)" : void 0
				}
			}, ...hours.map((minutes) => react.default.createElement("div", {
				key: minutes,
				style: {
					position: "absolute",
					left: 0,
					right: 0,
					top: (minutes - axis.start) * PX_PER_MINUTE,
					height: 1,
					background: "var(--dsw-alias-border-l1, #00000010)",
					pointerEvents: "none"
				}
			})), dragging?.day === day.key ? react.default.createElement("div", {
				key: "drag-preview",
				"aria-hidden": true,
				style: {
					position: "absolute",
					left: 2,
					right: 2,
					top: dragging.from * PX_PER_MINUTE,
					height: Math.max(22, dragging.to - dragging.from) * PX_PER_MINUTE,
					borderRadius: 6,
					pointerEvents: "none",
					zIndex: 2,
					border: "1px dashed var(--dsw-alias-state-business-primary, #4d6bfe)",
					background: "color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 14%, transparent)"
				}
			}, dragging.to > dragging.from ? react.default.createElement("div", { style: {
				padding: "2px 6px",
				fontSize: 11,
				color: PRIMARY,
				fontVariantNumeric: "tabular-nums"
			} }, `${clockAt(dragging.from)}–${clockAt(dragging.to)}`) : void 0) : void 0, ...(byDay.get(day.key) ?? []).map((entry) => react.default.createElement(Block, {
				key: entry.occurrence.occurrenceId,
				entry,
				axisStart: axis.start,
				tint: tintOf(entry.occurrence.source ?? entry.occurrence.uid),
				onSelect
			}))));
			const nowLine = nowVisible ? react.default.createElement("div", {
				"aria-hidden": true,
				style: {
					position: "absolute",
					left: 0,
					right: 0,
					top: (nowMinutes - axis.start) * PX_PER_MINUTE,
					height: 2,
					background: "var(--dsw-alias-state-error-primary, #d4553f)",
					zIndex: 3,
					pointerEvents: "none"
				}
			}) : void 0;
			const axisRow = react.default.createElement("div", { style: {
				display: "flex",
				height: axisHeight + 12,
				minHeight: "100%",
				paddingRight: 8
			} }, react.default.createElement("div", { style: {
				position: "relative",
				width: GUTTER,
				flex: "0 0 auto"
			} }, ...hourLabels), react.default.createElement("div", { style: {
				position: "relative",
				flex: "1 1 0",
				display: "flex"
			} }, ...columns, nowLine));
			return react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				flex: "1 1 auto",
				minHeight: 0
			} }, headerRow, react.default.createElement("div", {
				ref: scroller,
				style: {
					flex: "1 1 auto",
					minHeight: 0,
					overflowY: "auto",
					overflowX: "hidden"
				}
			}, axisRow));
		}
		/** The details of one occurrence, and every change the panel can make to it. */
		function EventDialog({ occurrence, event, service, onClose, run, onEdit }) {
			const [editing, setEditing] = (0, react.useState)(false);
			const [confirming, setConfirming] = (0, react.useState)(false);
			const [form, setForm] = (0, react.useState)({
				start: occurrence?.start ?? "",
				end: occurrence?.end ?? "",
				location: occurrence?.location ?? ""
			});
			(0, react.useEffect)(() => {
				setEditing(false);
				setConfirming(false);
				setForm({
					start: occurrence?.start ?? "",
					end: occurrence?.end ?? "",
					location: occurrence?.location ?? ""
				});
			}, [occurrence]);
			if (!occurrence) return null;
			const date = occurrence.occurrenceDate ?? dateOf(occurrence.start);
			const series = Boolean(event?.recurrence);
			const wholeDay = clockOf(occurrence.start) === "";
			form.start !== (occurrence.start ?? "") || form.end !== (occurrence.end ?? "") || (form.location, occurrence.location);
			const keptLength = !wholeDay && form.end === (occurrence.end ?? "") ? shiftedEnd(form.start, occurrence.start ?? form.start, occurrence.end ?? "") : void 0;
			const patch = withoutEmpty({
				start: form.start !== occurrence.start ? form.start : void 0,
				end: keptLength ?? (form.end !== (occurrence.end ?? "") ? form.end : void 0),
				location: form.location !== (occurrence.location ?? "") ? form.location : void 0
			});
			/**
			* A series keeps one record per rule and marks the exceptions, so a change to
			* a single occurrence of one is an override. A one-off entry has no series to
			* keep in step: an override there would be a `RECURRENCE-ID` on a `VEVENT`
			* without `RRULE`, which RFC 5545 does not allow, so the record itself is what
			* gets edited.
			*/
			const save = () => series ? service.applyOverride({
				uid: occurrence.uid,
				date,
				patch
			}) : service.putEvent(withoutEmpty({
				...event,
				start: patch.start ?? event?.start,
				end: patch.end ?? event?.end,
				location: patch.location ?? event?.location
			}));
			const actions = [];
			if (!editing) actions.push(react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: "when",
				variant: "outline",
				size: "sm",
				onClick: () => wholeDay && event ? onEdit(event.uid) : setEditing(true)
			}, wholeDay ? "改日期或地点" : series ? "改期或改地点" : "改时间或地点"));
			if (event) actions.push(react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: "record",
				variant: "ghost",
				size: "sm",
				onClick: () => onEdit(event.uid)
			}, "编辑日程信息"));
			if (occurrence.overridden) actions.push(react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: "undo",
				variant: "ghost",
				size: "sm",
				disabled: false,
				onClick: () => run(() => service.removeOverride({
					uid: occurrence.uid,
					date
				}), "已恢复原定安排").then((ok) => ok && onClose())
			}, "撤销改期"));
			if (series) actions.push(react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: "cancel",
				variant: "ghost",
				size: "sm",
				onClick: () => run(() => service.cancelOccurrence({
					uid: occurrence.uid,
					date
				}), `已取消：${shortDate(date)}`).then((ok) => ok && onClose())
			}, "取消这一次"));
			else actions.push(react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: "delete",
				variant: "ghost",
				size: "sm",
				style: { color: "var(--dsw-alias-state-error-primary, #d4553f)" },
				onClick: () => setConfirming(true)
			}, "删除日程"));
			return react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose,
				title: occurrence.title,
				closeLabel: "关闭",
				description: series ? seriesSummary(event) : void 0,
				footer: react.default.createElement("div", { style: {
					display: "flex",
					gap: 8,
					flexWrap: "wrap",
					alignItems: "center"
				} }, ...actions, react.default.createElement("span", { style: { flex: "1 1 auto" } }), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					onClick: onClose
				}, "关闭"))
			}, react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				flexWrap: "wrap"
			} }, react.default.createElement("span", { style: {
				fontSize: 13,
				color: PRIMARY,
				fontVariantNumeric: "tabular-nums"
			} }, `${monthOf(date)}${dayNumber(date)}日 ${weekdayOf(date)} ${clockRange(occurrence)}`), occurrence.overridden ? react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, "已改期") : void 0, series ? react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "outline" }, "重复日程中的一次") : react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "quiet" }, "单次日程")), occurrence.location ? react.default.createElement("div", { style: {
				fontSize: 13,
				color: PRIMARY
			} }, `地点：${occurrence.location}`) : void 0, occurrence.description ? react.default.createElement("div", { style: {
				fontSize: 12,
				color: SECONDARY,
				whiteSpace: "pre-wrap"
			} }, occurrence.description) : void 0, event?.source ? react.default.createElement("div", null, react.default.createElement(Muted, null, `来源：${event.source}`)) : void 0, editing ? react.default.createElement("div", { style: {
				marginTop: 4,
				padding: 12,
				borderRadius: 10,
				background: LAYER,
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement(Field, { label: "开始" }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "datetime-local",
				value: form.start,
				onChange: (event) => setForm({
					...form,
					start: event.target.value
				})
			})), react.default.createElement(Field, {
				label: "结束",
				hint: "留空表示沿用原本的时长"
			}, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "datetime-local",
				value: form.end,
				onChange: (event) => setForm({
					...form,
					end: event.target.value
				})
			})), react.default.createElement(Field, { label: "地点" }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Input, {
				value: form.location,
				placeholder: "留空表示沿用原来的地点",
				onChange: (event) => setForm({
					...form,
					location: event.target.value
				})
			})), react.default.createElement("div", { style: {
				display: "flex",
				gap: 8,
				alignItems: "center"
			} }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				disabled: Object.keys(patch).length === 0 || !series && !event,
				onClick: () => run(save, series ? "已保存这次调整" : "已保存修改").then((ok) => ok && onClose())
			}, "保存"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: () => setEditing(false)
			}, "取消"), react.default.createElement(Muted, null, series ? "只改这一次，系列其他日期不受影响" : "只改这一条日程"))) : void 0, confirming ? react.default.createElement("div", { style: {
				marginTop: 4,
				padding: 12,
				borderRadius: 10,
				background: LAYER,
				display: "flex",
				alignItems: "center",
				gap: 8,
				flexWrap: "wrap"
			} }, react.default.createElement("span", { style: { fontSize: 13 } }, "确定删除这条日程？"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				style: { background: "var(--dsw-alias-state-error-primary, #d4553f)" },
				onClick: () => run(() => service.deleteEvent({ uid: occurrence.uid }), "已删除这条日程").then((ok) => ok && onClose())
			}, "删除"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: () => setConfirming(false)
			}, "取消")) : void 0));
		}
		/** Read a dropped or chosen file as text, with the few checks a calendar import needs. */
		async function readCalendarFile(file) {
			const name = file.name.toLowerCase();
			if (!(name.endsWith(".ics") || name.endsWith(".ical") || name.endsWith(".txt") || file.type.includes("calendar") || file.type.startsWith("text/"))) throw new Error("只支持 .ics 日历文件");
			const text = await file.text();
			if (text.trim() === "") throw new Error("文件是空的");
			return text;
		}
		/** The import dialog: drop a file or paste text, then read what the import did. */
		function ImportDialog({ initialText, initialName, service, onClose, run }) {
			const [text, setText] = (0, react.useState)(initialText ?? "");
			const [source, setSource] = (0, react.useState)(DEFAULT_SOURCE);
			const [replace, setReplace] = (0, react.useState)(true);
			const [name, setName] = (0, react.useState)(initialName ?? "");
			const [dragging, setDragging] = (0, react.useState)(false);
			const [problem, setProblem] = (0, react.useState)(null);
			const [outcome, setOutcome] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const picker = (0, react.useRef)(null);
			const accept = (0, react.useCallback)(async (file) => {
				try {
					setText(await readCalendarFile(file));
					setName(file.name);
					setProblem(null);
				} catch (error) {
					setProblem(messageOf(error));
				}
			}, []);
			const submit = async () => {
				setBusy(true);
				setProblem(null);
				try {
					setOutcome(await service.importIcs({
						text,
						source: source.trim() === "" ? DEFAULT_SOURCE : source.trim(),
						replace
					}));
				} catch (error) {
					setProblem(messageOf(error));
				} finally {
					setBusy(false);
				}
			};
			const count = text.trim() === "" ? 0 : text.split(/\r\n|\r|\n/).filter((line) => line.startsWith("BEGIN:VEVENT")).length;
			return react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose,
				title: outcome ? "导入结果" : "导入日历",
				closeLabel: "关闭",
				description: outcome ? `来源 ${source.trim() === "" ? DEFAULT_SOURCE : source.trim()}` : "粘贴日历文本，或把 .ics 文件拖到这里；同一来源的旧记录会被替换，自己手动改过的记录不受影响。",
				footer: react.default.createElement("div", { style: {
					display: "flex",
					gap: 8,
					alignItems: "center"
				} }, outcome ? react.default.createElement(react.default.Fragment, null, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					onClick: () => {
						setOutcome(null);
						setText("");
						setName("");
					}
				}, "再导一份"), react.default.createElement("span", { style: { flex: "1 1 auto" } }), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					onClick: onClose
				}, "完成")) : react.default.createElement(react.default.Fragment, null, react.default.createElement(Muted, null, count > 0 ? `识别到 ${count} 条日程` : "等待日历文本"), react.default.createElement("span", { style: { flex: "1 1 auto" } }), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					onClick: onClose
				}, "取消"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					disabled: text.trim() === "" || busy,
					onClick: submit
				}, busy ? "正在导入…" : "导入")))
			}, outcome ? react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 12
			} }, react.default.createElement("div", { style: {
				display: "flex",
				gap: 8,
				flexWrap: "wrap"
			} }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `日程 ${outcome.events} 条`), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `移除旧日程 ${outcome.removedEvents} 条`)), react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				fontSize: 13,
				color: PRIMARY
			} }, react.default.createElement(IconCheck), outcome.events > 0 ? "已写入日历" : "没有写入新的日程"), outcome.skipped.length > 0 ? react.default.createElement("div", null, react.default.createElement(Muted, { style: {
				display: "block",
				marginBottom: 4
			} }, `未导入 ${outcome.skipped.length} 条`), react.default.createElement("ul", { style: {
				margin: 0,
				paddingLeft: 18,
				fontSize: 12,
				color: SECONDARY
			} }, ...outcome.skipped.map((entry, index) => react.default.createElement("li", { key: index }, `${entry.uid ? `${entry.uid}：` : ""}${entry.reason}`)))) : void 0, outcome.degraded.length > 0 ? react.default.createElement("div", null, react.default.createElement(Muted, { style: {
				display: "block",
				marginBottom: 4
			} }, `重复规则降级为单次 ${outcome.degraded.length} 条`), react.default.createElement("ul", { style: {
				margin: 0,
				paddingLeft: 18,
				fontSize: 12,
				color: SECONDARY
			} }, ...outcome.degraded.map((entry, index) => react.default.createElement("li", { key: index }, `${entry.rrule ?? entry.uid ?? ""}${entry.reason ? `（${entry.reason}）` : ""}`)))) : void 0) : react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 12
			} }, react.default.createElement("div", {
				onDragEnter: (event) => {
					event.preventDefault();
					setDragging(true);
				},
				onDragOver: (event) => {
					event.preventDefault();
					setDragging(true);
				},
				onDragLeave: () => setDragging(false),
				onDrop: async (event) => {
					event.preventDefault();
					setDragging(false);
					const file = event.dataTransfer?.files?.[0];
					if (file) await accept(file);
				},
				style: {
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: 6,
					padding: "20px 16px",
					borderRadius: 12,
					textAlign: "center",
					border: `1px dashed ${dragging ? "var(--dsw-alias-state-business-primary, #4d6bfe)" : "var(--dsw-alias-border-l2, #0000002e)"}`,
					background: dragging ? "color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 6%, transparent)" : LAYER
				}
			}, react.default.createElement(IconFolderOpen), react.default.createElement("strong", { style: { fontSize: 13 } }, name === "" ? "把 .ics 文件拖到这里" : name), react.default.createElement(Muted, null, name === "" ? "也可以点下面的按钮选择文件" : "已读取文件内容，可以直接导入"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: () => picker.current?.click()
			}, "选择文件"), react.default.createElement("input", {
				ref: (node) => {
					picker.current = node;
				},
				type: "file",
				accept: ".ics,.ical,.txt,text/calendar",
				style: { display: "none" },
				onChange: async (event) => {
					const file = event.target.files?.[0];
					if (file) await accept(file);
					event.target.value = "";
				}
			})), react.default.createElement("textarea", {
				value: text,
				onChange: (event) => setText(event.target.value),
				placeholder: "BEGIN:VCALENDAR …",
				spellCheck: false,
				style: {
					width: "100%",
					minHeight: 148,
					resize: "vertical",
					boxSizing: "border-box",
					padding: 10,
					borderRadius: 10,
					border: CARD_BORDER,
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					color: PRIMARY,
					fontFamily: "var(--ds-font-family-code, ui-monospace, monospace)",
					fontSize: 12,
					lineHeight: 1.5
				}
			}), react.default.createElement("div", { style: {
				display: "flex",
				gap: 12,
				alignItems: "flex-end",
				flexWrap: "wrap"
			} }, react.default.createElement("div", { style: { flex: "1 1 200px" } }, react.default.createElement(Field, {
				label: "来源",
				hint: "同一来源再次导入会替换它自己的旧记录"
			}, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Input, {
				value: source,
				onChange: (event) => setSource(event.target.value)
			}))), react.default.createElement("div", { style: { paddingBottom: 18 } }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: replace,
				onChange: setReplace,
				label: "替换同来源的旧记录"
			}))), problem ? react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				fontSize: 12,
				color: "var(--dsw-alias-state-error-primary, #d4553f)"
			} }, react.default.createElement(IconWarning), problem) : void 0));
		}
		/** The export dialog: the calendar text, ready to copy or to download. */
		function ExportDialog({ service, onClose, toast }) {
			const [text, setText] = (0, react.useState)("");
			const [problem, setProblem] = (0, react.useState)(null);
			const [copied, setCopied] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let alive = true;
				service.exportIcs({}).then((result) => {
					if (alive) setText(result.text);
				}).catch((error) => {
					if (alive) setProblem(messageOf(error));
				});
				return () => {
					alive = false;
				};
			}, [service]);
			const save = () => {
				const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = "日历.ics";
				link.click();
				URL.revokeObjectURL(url);
			};
			const lines = text === "" ? 0 : text.split("\r\n").length;
			return react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose,
				title: "导出日历",
				closeLabel: "关闭",
				description: "标准 iCalendar 文本，可以复制或下载后导入其他日历应用。",
				footer: react.default.createElement("div", { style: {
					display: "flex",
					gap: 8,
					alignItems: "center"
				} }, react.default.createElement(Muted, null, text === "" ? "正在生成…" : `${lines} 行 · ${text.length} 字符`), react.default.createElement("span", { style: { flex: "1 1 auto" } }), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					icon: react.default.createElement(IconCopy),
					disabled: text === "",
					onClick: async () => {
						const ok = await (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(text);
						setCopied(ok);
						toast(ok ? "已复制日历文本" : "复制失败，请手动选择文本");
					}
				}, copied ? "已复制" : "复制"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					icon: react.default.createElement(IconDownload),
					disabled: text === "",
					onClick: save
				}, "下载 .ics"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					onClick: onClose
				}, "完成"))
			}, react.default.createElement("textarea", {
				readOnly: true,
				value: text,
				spellCheck: false,
				onFocus: (event) => event.target.select(),
				style: {
					width: "100%",
					minHeight: 300,
					maxHeight: "46vh",
					resize: "vertical",
					boxSizing: "border-box",
					padding: 10,
					borderRadius: 10,
					border: CARD_BORDER,
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					color: PRIMARY,
					fontFamily: "var(--ds-font-family-code, ui-monospace, monospace)",
					fontSize: 12,
					lineHeight: 1.5,
					whiteSpace: "pre",
					overflowX: "auto",
					overflowY: "auto"
				}
			}), problem ? react.default.createElement("div", { style: {
				marginTop: 8,
				fontSize: 12,
				color: "var(--dsw-alias-state-error-primary, #d4553f)"
			} }, problem) : void 0);
		}
		/** One entry row of the agenda: date, time, place, and the actions that fit a row. */
		function EventRow({ occurrence, tint, onOpen, onCancel, onDelete }) {
			const [hovered, hover] = useHover();
			const date = dateOf(occurrence.start);
			const series = Boolean(occurrence.recurrence);
			return react.default.createElement("div", {
				...hover,
				style: {
					display: "grid",
					gridTemplateColumns: `${GUTTER}px minmax(0, 1fr) auto`,
					alignItems: "center",
					gap: 10,
					padding: "8px 12px",
					borderTop: HAIRLINE,
					background: hovered ? HOVER : "transparent"
				}
			}, react.default.createElement("div", { style: { textAlign: "center" } }, react.default.createElement("div", { style: {
				fontSize: 11,
				color: SECONDARY
			} }, weekdayOf(date)), react.default.createElement("div", { style: {
				fontSize: 15,
				fontWeight: 650,
				color: PRIMARY
			} }, dayNumber(date))), react.default.createElement("button", {
				type: "button",
				onClick: () => onOpen(occurrence),
				style: {
					display: "block",
					minWidth: 0,
					padding: 0,
					border: "none",
					background: "none",
					textAlign: "left",
					cursor: "pointer",
					fontFamily: "inherit",
					color: PRIMARY
				}
			}, react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				minWidth: 0
			} }, react.default.createElement("span", {
				"aria-hidden": true,
				style: {
					width: 8,
					height: 8,
					borderRadius: 999,
					background: tint.accent,
					flex: "0 0 auto"
				}
			}), react.default.createElement("span", { style: {
				fontSize: 13,
				fontWeight: 550,
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis"
			} }, occurrence.title), occurrence.overridden ? react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, "已改期") : void 0), react.default.createElement("div", { style: {
				marginTop: 2,
				fontSize: 12,
				color: SECONDARY,
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis"
			} }, [clockRange(occurrence), occurrence.location].filter(Boolean).join(" · "))), react.default.createElement("div", { style: {
				display: "flex",
				gap: 2,
				opacity: hovered ? 1 : 0,
				transition: "opacity .12s ease"
			} }, series ? react.default.createElement(IconButton, {
				label: "取消这一次",
				icon: react.default.createElement(IconArchive),
				onClick: () => onCancel(occurrence)
			}) : react.default.createElement(IconButton, {
				label: "删除日程",
				danger: true,
				icon: react.default.createElement(IconTrash),
				onClick: () => onDelete(occurrence)
			})));
		}
		/** Days between two `YYYY-MM-DD` dates, so a whole-day range keeps its span. */
		const daysBetween = (from, to) => Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 864e5);
		/** The editable fields of a stored record, as the form holds them. */
		const draftOf = (event) => ({
			title: event?.title ?? "",
			date: dateOf(event?.start ?? "") || localDate(),
			start: clockOf(event?.start),
			end: clockOf(event?.end),
			location: event?.location ?? "",
			description: noteOf(event),
			repeat: Boolean(event?.recurrence),
			until: event?.recurrence?.until ? dateOf(event.recurrence.until) : ""
		});
		/**
		* The record a draft describes, on top of the one it was read from.
		*
		* An emptied field disappears instead of lingering as an empty string: the host
		* stores the record it is handed, so the form is the whole truth about it.
		*/
		function recordOf(draft, base = {}) {
			const timed = draft.start !== "";
			const shift = base.start ? daysBetween(dateOf(base.start), draft.date) : 0;
			return withoutEmpty({
				...base,
				uid: base.uid ?? newUid(),
				title: draft.title.trim(),
				start: timed ? `${draft.date}T${draft.start}` : draft.date,
				end: timed ? draft.end === "" ? void 0 : `${draft.date}T${draft.end}` : base.end ? addDays(dateOf(base.end), shift) : void 0,
				location: draft.location.trim(),
				description: draft.description.trim(),
				recurrence: draft.repeat ? withoutEmpty({
					...base.recurrence ?? {},
					freq: "weekly",
					until: draft.until
				}) : void 0,
				exceptions: draft.repeat ? base.exceptions : void 0,
				overrides: draft.repeat ? base.overrides : void 0
			});
		}
		/** Why a draft cannot be saved yet, or `null` when it can. */
		function draftProblem(draft) {
			if (draft.title.trim() === "") return "标题不能为空";
			if (draft.date === "") return "需要选一个日期";
			if (draft.start !== "" && draft.end !== "" && draft.end <= draft.start) return "结束时间要晚于开始时间";
			return null;
		}
		/**
		* The fields of one record, shared by the new-entry dialog and the entry page:
		* what the reader owns about an entry, as opposed to one date of a series.
		*/
		function EventForm({ draft, onChange, autoFocus }) {
			const set = (patch) => onChange({
				...draft,
				...patch
			});
			return react.default.createElement(react.default.Fragment, null, react.default.createElement(Field, { label: "标题" }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Input, {
				value: draft.title,
				placeholder: "例如：组会、体检、回家",
				autoFocus,
				onChange: (event) => set({ title: event.target.value })
			})), react.default.createElement("div", { style: {
				display: "flex",
				gap: 8,
				flexWrap: "wrap"
			} }, react.default.createElement("div", { style: { flex: "1 1 150px" } }, react.default.createElement(Field, { label: "日期" }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "date",
				value: draft.date,
				onChange: (event) => set({ date: event.target.value })
			}))), react.default.createElement("div", { style: { flex: "1 1 90px" } }, react.default.createElement(Field, { label: "开始" }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "time",
				value: draft.start,
				onChange: (event) => set({ start: event.target.value })
			}))), react.default.createElement("div", { style: { flex: "1 1 90px" } }, react.default.createElement(Field, {
				label: "结束",
				hint: "留空按 45 分钟显示"
			}, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "time",
				value: draft.end,
				onChange: (event) => set({ end: event.target.value })
			})))), react.default.createElement(Field, { label: "地点" }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Input, {
				value: draft.location,
				placeholder: "可留空",
				onChange: (event) => set({ location: event.target.value })
			})), react.default.createElement(Field, {
				label: "备注",
				hint: "随导出写进日历，不会同步到任何服务"
			}, react.default.createElement("textarea", {
				value: draft.description,
				rows: 3,
				spellCheck: false,
				onChange: (event) => set({ description: event.target.value }),
				style: {
					width: "100%",
					boxSizing: "border-box",
					padding: "6px 8px",
					borderRadius: 8,
					resize: "vertical",
					border: CARD_BORDER,
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					color: PRIMARY,
					fontSize: 13,
					fontFamily: "inherit",
					lineHeight: 1.5
				}
			})), react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginBottom: 12
			} }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: draft.repeat,
				label: "每周重复",
				onChange: (next) => set({
					repeat: next,
					until: next ? draft.until : ""
				})
			}), react.default.createElement("span", { style: {
				fontSize: 13,
				color: PRIMARY
			} }, "每周重复"), react.default.createElement(Muted, null, "按开始日期的星期")), draft.repeat ? react.default.createElement(Field, {
				label: "重复到",
				hint: "留空表示一直重复"
			}, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "date",
				value: draft.until,
				onChange: (event) => set({ until: event.target.value })
			})) : void 0);
		}
		/** The dialog that creates one entry by hand. */
		function CreateDialog({ defaultDate, defaultStart, defaultEnd, service, onClose, run, onSaved }) {
			const [draft, setDraft] = (0, react.useState)(() => {
				const date = defaultDate ?? localDate();
				const start = defaultStart ?? clockAt(suggestedStart(date));
				return {
					...draftOf(null),
					date,
					start,
					end: defaultEnd ?? clockAt(Math.min(clockMinutes(start) + 60, 1439))
				};
			});
			const [problem, setProblem] = (0, react.useState)(null);
			const complaint = draftProblem(draft);
			const submit = async () => {
				if (complaint) {
					setProblem(complaint);
					return;
				}
				if (await run(() => service.putEvent(recordOf(draft)), "已新建日程")) onSaved();
			};
			return react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose,
				title: "新建日程",
				closeLabel: "关闭",
				description: "写进本机日历，随时可以再改。",
				footer: react.default.createElement("div", { style: {
					display: "flex",
					gap: 8,
					alignItems: "center"
				} }, react.default.createElement(Muted, null, draft.repeat ? "每周重复" : "单次日程"), react.default.createElement("span", { style: { flex: "1 1 auto" } }), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					onClick: onClose
				}, "取消"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					disabled: Boolean(complaint),
					onClick: submit
				}, "新建"))
			}, react.default.createElement("div", null, react.default.createElement(EventForm, {
				draft,
				onChange: setDraft,
				autoFocus: true
			}), problem ? react.default.createElement("div", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-state-error-primary, #d4553f)"
			} }, problem) : void 0));
		}
		/**
		* One stored entry: what it is on the left, the dates it produces on the right.
		* Wide panels show both at once; a narrow one stacks them, because the panel
		* width is the reader's, not ours.
		*/
		function EventPage({ event, agenda, onOpenOccurrence, onSave, onRestore, onCancel, onDelete, busy }) {
			const [draft, setDraft] = (0, react.useState)(() => draftOf(event));
			const [problem, setProblem] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setDraft(draftOf(event));
				setProblem(null);
			}, [event]);
			const uuid = event?.uid;
			const occurrences = (0, react.useMemo)(() => (agenda ?? []).filter((occurrence) => occurrence.uid === uuid), [agenda, uuid]);
			const groups = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				for (const occurrence of occurrences) {
					const key = occurrence.start.slice(0, 7);
					if (!map.has(key)) map.set(key, []);
					map.get(key).push(occurrence);
				}
				return [...map.entries()];
			}, [occurrences]);
			if (!event) return null;
			const tint = tintOf(event.source ?? event.uid);
			const exceptions = (event.exceptions ?? []).map(dateOf);
			const complaint = draftProblem(draft);
			const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(event));
			const save = () => {
				if (complaint) {
					setProblem(complaint);
					return;
				}
				if (dirty) onSave(recordOf(draft, event));
			};
			const infoCard = react.default.createElement("section", { style: {
				padding: 16,
				borderRadius: 12,
				border: CARD_BORDER,
				background: "var(--dsw-alias-bg-layer-1, #fff)"
			} }, react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginBottom: 12,
				flexWrap: "wrap"
			} }, react.default.createElement("span", {
				"aria-hidden": true,
				style: {
					width: 10,
					height: 10,
					borderRadius: 999,
					background: tint.accent
				}
			}), react.default.createElement("strong", { style: { fontSize: 13 } }, "日程信息"), react.default.createElement("span", { style: { flex: "1 1 auto" } }), event.recurrence ? react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "outline" }, seriesSummary(event)) : void 0, event.source ? react.default.createElement(Muted, null, event.source) : void 0), react.default.createElement(EventForm, {
				draft,
				onChange: setDraft
			}), react.default.createElement("div", { style: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				flexWrap: "wrap"
			} }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				disabled: !dirty || busy || Boolean(complaint),
				onClick: save
			}, "保存更改"), dirty ? react.default.createElement(Muted, null, complaint ?? "有未保存的改动") : void 0, react.default.createElement("span", { style: { flex: "1 1 auto" } }), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				icon: react.default.createElement(IconTrash),
				style: { color: "var(--dsw-alias-state-error-primary, #d4553f)" },
				onClick: () => onDelete(event)
			}, "删除这条日程")));
			const cancelledCard = exceptions.length === 0 ? void 0 : react.default.createElement("section", { style: {
				padding: 16,
				borderRadius: 12,
				border: CARD_BORDER,
				background: "var(--dsw-alias-bg-layer-1, #fff)"
			} }, react.default.createElement("strong", { style: {
				display: "block",
				marginBottom: 10,
				fontSize: 13
			} }, "已取消的日期"), react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				flexWrap: "wrap"
			} }, ...exceptions.map((date) => react.default.createElement("span", {
				key: date,
				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 2,
					padding: "1px 4px 1px 7px",
					borderRadius: 999,
					background: LAYER,
					fontSize: 11
				}
			}, shortDate(date), react.default.createElement(IconButton, {
				label: `恢复 ${shortDate(date)}`,
				icon: react.default.createElement(IconRefreshSmall),
				onClick: () => onRestore(event, date)
			})))));
			const monthBlocks = groups.flatMap(([month, items]) => [react.default.createElement("div", {
				key: month,
				style: {
					padding: "6px 12px",
					background: LAYER,
					fontSize: 12,
					color: SECONDARY,
					position: "sticky",
					top: 0
				}
			}, monthOf(`${month}-01`)), ...items.map((occurrence) => react.default.createElement(EventRow, {
				key: occurrence.occurrenceId,
				occurrence,
				tint,
				onOpen: onOpenOccurrence,
				onCancel: (item) => onCancel(item),
				onDelete: (item) => onDelete(item)
			}))]);
			const listCard = react.default.createElement("div", { style: {
				flex: "2 1 420px",
				minWidth: 280,
				borderRadius: 12,
				border: CARD_BORDER,
				background: "var(--dsw-alias-bg-layer-1, #fff)",
				overflow: "hidden"
			} }, react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "10px 12px",
				flexWrap: "wrap"
			} }, react.default.createElement("strong", { style: { fontSize: 13 } }, "出现的时间"), react.default.createElement(Muted, null, `近一年内 ${occurrences.length} 次`), react.default.createElement("span", { style: { flex: "1 1 auto" } }), react.default.createElement(Muted, null, "点一条查看或调整")), occurrences.length === 0 ? react.default.createElement("div", { style: {
				padding: "24px 12px",
				textAlign: "center"
			} }, react.default.createElement(Muted, null, "近一年内没有它出现的时间")) : react.default.createElement("div", null, ...monthBlocks));
			return react.default.createElement("div", { style: {
				flex: "1 1 auto",
				minHeight: 0,
				overflowY: "auto"
			} }, react.default.createElement("div", { style: {
				display: "flex",
				gap: 16,
				alignItems: "flex-start",
				flexWrap: "wrap",
				padding: "16px 20px 24px"
			} }, react.default.createElement("div", { style: {
				flex: "1 1 300px",
				maxWidth: 420,
				minWidth: 260,
				display: "flex",
				flexDirection: "column",
				gap: 12
			} }, infoCard, cancelledCard), listCard));
		}
		/** The panel: the week, the entry list behind a menu, and the dialogs. */
		function createCalendarPage(service) {
			return function CalendarPanel() {
				const [view, setView] = (0, react.useState)({ kind: "week" });
				const [anchor, setAnchor] = (0, react.useState)(() => startOfWeek());
				const [snapshot, setSnapshot] = (0, react.useState)(null);
				const [week, setWeek] = (0, react.useState)(null);
				const [agenda, setAgenda] = (0, react.useState)(null);
				const [loading, setLoading] = (0, react.useState)(true);
				const [problem, setProblem] = (0, react.useState)(null);
				const [toast, setToast] = (0, react.useState)(null);
				const [menuOpen, setMenuOpen] = (0, react.useState)(false);
				const [dialog, setDialog] = (0, react.useState)(null);
				const [dropping, setDropping] = (0, react.useState)(false);
				const [busy, setBusy] = (0, react.useState)(false);
				const events = snapshot?.events ?? [];
				const weekRange = {
					from: anchor,
					to: addDays(anchor, 6)
				};
				const agendaRange = {
					from: addDays(localDate(), -180),
					to: addDays(localDate(), 366)
				};
				const loadSnapshot = (0, react.useCallback)(async () => {
					setSnapshot(await service.snapshot());
				}, [service]);
				const loadWeek = (0, react.useCallback)(async () => {
					setWeek(await service.occurrences(weekRange));
				}, [service, anchor]);
				const loadAgenda = (0, react.useCallback)(async () => {
					setAgenda((await service.occurrences(agendaRange)).occurrences);
				}, [service, view.id]);
				const refresh = (0, react.useCallback)(async () => {
					setLoading(true);
					try {
						await loadSnapshot();
						if (view.kind === "week") await loadWeek();
						if (view.kind === "event") await loadAgenda();
						setProblem(null);
					} catch (error) {
						setProblem(messageOf(error));
					} finally {
						setLoading(false);
					}
				}, [
					loadSnapshot,
					loadWeek,
					loadAgenda,
					view.kind
				]);
				(0, react.useEffect)(() => {
					refresh();
				}, [refresh]);
				/** Run one write, then re-read: the panel never guesses what the host stored. */
				const run = (0, react.useCallback)(async (action, success) => {
					setBusy(true);
					try {
						await action();
						await refresh();
						if (success) setToast(success);
						return true;
					} catch (error) {
						setProblem(messageOf(error));
						return false;
					} finally {
						setBusy(false);
					}
				}, [refresh]);
				const openEvent = (0, react.useCallback)((uid) => {
					setDialog(null);
					setMenuOpen(false);
					setView({
						kind: "event",
						id: uid
					});
				}, []);
				/** A drag or a double click in the week asks for a new entry over that span. */
				const createAt = (0, react.useCallback)((date, from, to) => {
					setDialog({
						kind: "create",
						date,
						start: clockAt(from),
						end: clockAt(Math.max(to, from + 15))
					});
				}, []);
				const current = view.kind === "event" ? events.find((event) => event.uid === view.id) : void 0;
				const weekCount = week?.occurrences?.length ?? 0;
				/** The week on screen is today's, so an entry started from here means today. */
				const createDate = anchor === startOfWeek() ? localDate() : anchor;
				const title = view.kind === "week" ? "我的日历" : current?.title ?? "日程";
				const subtitle = view.kind === "week" ? `${monthOf(anchor)}${dayNumber(anchor)}日 – ${shortDate(addDays(anchor, 6))} · ${weekCount} 条` : [
					current?.location,
					current?.source,
					current && noteOf(current) !== "" ? "有备注" : ""
				].filter(Boolean).join(" · ");
				const menuItems = events.length === 0 ? [{
					type: "label",
					id: "none",
					text: "还没有日程"
				}] : events.map((event) => ({
					id: event.uid,
					label: event.title,
					icon: react.default.createElement(IconClock)
				}));
				return react.default.createElement("div", {
					onDragEnter: (event) => {
						if (event.dataTransfer?.types?.includes("Files")) {
							event.preventDefault();
							setDropping(true);
						}
					},
					onDragOver: (event) => {
						if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
					},
					onDragLeave: (event) => {
						if (event.currentTarget === event.target) setDropping(false);
					},
					onDrop: async (event) => {
						event.preventDefault();
						setDropping(false);
						const file = event.dataTransfer?.files?.[0];
						if (!file) return;
						try {
							const text = await readCalendarFile(file);
							setView({ kind: "week" });
							setDialog({
								kind: "import",
								text,
								name: file.name
							});
						} catch (error) {
							setProblem(messageOf(error));
						}
					},
					style: {
						position: "relative",
						height: "100%",
						display: "flex",
						flexDirection: "column",
						minHeight: 0,
						background: PAGE_BACKGROUND,
						color: PRIMARY
					}
				}, react.default.createElement("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: 8,
					flexWrap: "wrap",
					padding: "12px 16px",
					borderBottom: CARD_BORDER,
					flex: "0 0 auto"
				} }, view.kind === "event" ? react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					icon: react.default.createElement(IconChevronLeft),
					onClick: () => setView({ kind: "week" })
				}, "返回") : void 0, react.default.createElement("div", { style: { minWidth: 0 } }, react.default.createElement("div", { style: {
					fontSize: 16,
					fontWeight: 650,
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis"
				} }, title), react.default.createElement("div", { style: {
					fontSize: 12,
					color: SECONDARY
				} }, loading ? "正在读取…" : subtitle)), react.default.createElement("span", { style: { flex: "1 1 auto" } }), view.kind === "week" ? react.default.createElement(react.default.Fragment, null, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					disabled: anchor === startOfWeek(),
					onClick: () => setAnchor(startOfWeek())
				}, "今天"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: "上一周",
					side: "bottom"
				}, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					"aria-label": "上一周",
					icon: react.default.createElement(IconChevronLeft),
					onClick: () => setAnchor(addDays(anchor, -7))
				})), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: "下一周",
					side: "bottom"
				}, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					"aria-label": "下一周",
					icon: react.default.createElement(IconChevronRight),
					onClick: () => setAnchor(addDays(anchor, 7))
				}))) : void 0, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					icon: react.default.createElement(IconPlus),
					onClick: () => setDialog({
						kind: "create",
						date: view.kind === "event" && current ? dateOf(current.start) : createDate
					})
				}, "新建日程"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Menu, {
					open: menuOpen,
					onClose: () => setMenuOpen(false),
					items: menuItems,
					selectedId: view.id,
					onSelect: (id) => events.some((event) => event.uid === id) ? openEvent(id) : void 0,
					align: "end",
					anchor: react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						icon: react.default.createElement(IconClock),
						onClick: () => setMenuOpen(!menuOpen)
					}, "日程", react.default.createElement(IconChevronDown))
				}), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					icon: react.default.createElement(IconFolderOpen),
					onClick: () => setDialog({ kind: "import" })
				}, "导入"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					icon: react.default.createElement(IconDownload),
					onClick: () => setDialog({ kind: "export" })
				}, "导出"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: "刷新",
					side: "bottom"
				}, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					"aria-label": "刷新",
					disabled: loading,
					icon: react.default.createElement(IconRefresh),
					onClick: () => void refresh()
				}))), problem ? react.default.createElement("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "6px 16px",
					fontSize: 12,
					flex: "0 0 auto",
					color: "var(--dsw-alias-state-error-primary, #d4553f)",
					background: "color-mix(in srgb, var(--dsw-alias-state-error-primary, #d4553f) 8%, transparent)"
				} }, react.default.createElement(IconWarning), problem) : void 0, view.kind === "week" ? events.length === 0 && weekCount === 0 && !loading ? react.default.createElement("div", { style: {
					flex: "1 1 auto",
					display: "grid",
					placeItems: "center",
					padding: 24
				} }, react.default.createElement("div", { style: {
					maxWidth: 380,
					padding: 20,
					borderRadius: 12,
					border: CARD_BORDER,
					background: LAYER,
					textAlign: "center"
				} }, react.default.createElement(IconAlarmClock), react.default.createElement("div", { style: {
					margin: "8px 0 4px",
					fontSize: 14,
					fontWeight: 600
				} }, "日历还是空的"), react.default.createElement(Muted, null, "先新建一条日程，或把从教务系统、其他日历导出的 .ics 文件拖进这个面板。双击时间轴上的空白处也能新建。"), react.default.createElement("div", { style: {
					marginTop: 12,
					display: "flex",
					gap: 8,
					justifyContent: "center"
				} }, react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					icon: react.default.createElement(IconPlus),
					onClick: () => setDialog({
						kind: "create",
						date: createDate
					})
				}, "新建日程"), react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					icon: react.default.createElement(IconFolderOpen),
					onClick: () => setDialog({ kind: "import" })
				}, "导入日历")))) : react.default.createElement(WeekGrid, {
					anchor,
					occurrences: week?.occurrences ?? [],
					onSelect: (occurrence) => setDialog({
						kind: "event",
						occurrence
					}),
					onCreate: createAt
				}) : react.default.createElement(EventPage, {
					event: current,
					agenda,
					busy,
					onOpenOccurrence: (occurrence) => setDialog({
						kind: "event",
						occurrence
					}),
					onSave: (event) => run(() => service.putEvent(event), "日程信息已保存"),
					onRestore: (event, date) => run(() => service.restoreOccurrence({
						uid: event.uid,
						date
					}), `已恢复 ${shortDate(date)} 的日程`),
					onDelete: (event) => run(() => service.deleteEvent({ uid: event.uid }), "已删除这条日程").then((ok) => {
						if (ok) setView({ kind: "week" });
					}),
					onCancel: (occurrence) => run(() => service.cancelOccurrence({
						uid: occurrence.uid,
						date: occurrence.occurrenceDate ?? dateOf(occurrence.start)
					}), `已取消 ${shortDate(occurrence.occurrenceDate ?? dateOf(occurrence.start))} 的日程`)
				}), dialog?.kind === "event" ? react.default.createElement(EventDialog, {
					occurrence: dialog.occurrence,
					event: events.find((item) => item.uid === dialog.occurrence?.uid),
					service,
					run,
					onEdit: openEvent,
					onClose: () => setDialog(null)
				}) : void 0, dialog?.kind === "create" ? react.default.createElement(CreateDialog, {
					defaultDate: dialog.date,
					defaultStart: dialog.start,
					defaultEnd: dialog.end,
					service,
					run,
					onSaved: () => setDialog(null),
					onClose: () => setDialog(null)
				}) : void 0, dialog?.kind === "import" ? react.default.createElement(ImportDialog, {
					initialText: dialog.text,
					initialName: dialog.name,
					service,
					run,
					onClose: () => {
						setDialog(null);
						refresh();
					}
				}) : void 0, dialog?.kind === "export" ? react.default.createElement(ExportDialog, {
					service,
					toast: setToast,
					onClose: () => setDialog(null)
				}) : void 0, toast ? react.default.createElement(_deepseek_ai_dsh_client_ui_primitives.Toast, {
					text: toast,
					onDone: () => setToast(null)
				}) : void 0, dropping ? react.default.createElement("div", {
					"aria-hidden": true,
					style: {
						position: "fixed",
						inset: 0,
						zIndex: 90,
						display: "grid",
						placeItems: "center",
						pointerEvents: "none",
						background: "color-mix(in srgb, var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, .32)) 82%, transparent)",
						backdropFilter: "blur(5px)"
					}
				}, react.default.createElement("div", { style: {
					padding: "22px 28px",
					textAlign: "center",
					borderRadius: 16,
					border: "1px dashed var(--dsw-alias-border-l2, #0000002e)",
					background: "var(--dsw-alias-bg-module-platform, #fff)",
					color: PRIMARY,
					boxShadow: "0 18px 50px rgba(0, 0, 0, .16)"
				} }, react.default.createElement("div", { style: { fontSize: 28 } }, "⇩"), react.default.createElement("strong", { style: {
					display: "block",
					fontSize: 14
				} }, "松开即可导入日历"), react.default.createElement(Muted, null, ".ics 文件会读进导入窗口，确认后再写入"))) : void 0);
			};
		}
		/** Sidebar glyph: a month grid with one marked day. */
		function CalendarIcon(props) {
			return react.default.createElement("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				stroke: "currentColor",
				strokeWidth: 1.2,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				...props
			}, react.default.createElement("rect", {
				x: 2,
				y: 3,
				width: 12,
				height: 11,
				rx: 2
			}), react.default.createElement("path", { d: "M2 6.5h12M5.5 2v2.5M10.5 2v2.5" }), react.default.createElement("path", {
				d: "M5 9.5h2.5v2.5H5z",
				fill: "currentColor",
				stroke: "none"
			}));
		}
		async function apply(ctx) {
			const disposeRemote = await ctx.remote.$mount(typert_remote_client_default);
			ctx.inject(["remote.calendar"], (surface) => {
				const call = (method) => (input) => unwrap(surface.remote.calendar[method](input));
				const service = {
					snapshot: () => unwrap(surface.remote.calendar.snapshot()),
					occurrences: call("occurrences"),
					importIcs: call("importIcs"),
					exportIcs: call("exportIcs"),
					applyOverride: call("applyOverride"),
					removeOverride: call("removeOverride"),
					cancelOccurrence: call("cancelOccurrence"),
					restoreOccurrence: call("restoreOccurrence"),
					deleteEvent: call("deleteEvent"),
					putEvent: call("putEvent")
				};
				surface.slots.inject("main", () => surface.slots.register({
					name: "main",
					key: PANEL_ID
				}, createCalendarPage(service)));
				surface.slots.inject("sidebar.panellist", () => surface.slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: 100,
					label: "日历"
				}, CalendarIcon));
			});
			return async () => {
				await disposeRemote();
			};
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
