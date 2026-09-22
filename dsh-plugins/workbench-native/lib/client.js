window.__ModuleLoader__.load({
	id: "@eduwork/workbench-native",
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
		let react_dom = require("react-dom");
		function downloadDiagnosticArchive(result) {
			if (!result.archive || !/^EduWork-diagnostics-[\w-]+\.zip$/.test(result.filename || "")) throw new Error(result.message || "诊断包未生成，请重试。");
			const bytes = Uint8Array.from(atob(result.archive), (char) => char.charCodeAt(0));
			if (bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) throw new Error("诊断包格式错误，请重试。");
			const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
			const link = document.createElement("a");
			link.href = url;
			link.download = result.filename;
			document.body.append(link);
			link.click();
			link.remove();
			setTimeout(() => URL.revokeObjectURL(url), 6e4);
		}
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
		const pkg$1 = "@eduwork/workbench-native";
		const codec = (name, schema) => ({
			mode: "strict",
			typeSymbol: `${pkg$1}#${name}`,
			schema
		});
		const row$1 = object({
			name: string(),
			description: string(),
			source: _enum(["builtin", "personal"]),
			available: boolean(),
			requirement: string(),
			removable: boolean()
		}).strict();
		const update = record(string(), union([
			string(),
			number(),
			boolean()
		])).optional();
		const importJob = codec("ImportJob", object({
			id: string(),
			state: _enum([
				"idle",
				"scanning",
				"ready",
				"running",
				"complete",
				"error"
			]),
			message: string(),
			total: number(),
			completed: number(),
			imported: number(),
			skipped: number(),
			conflicts: number(),
			files: number(),
			warnings: array(string()),
			report: string(),
			source: string(),
			sourceVersion: string(),
			targetFormat: number(),
			formats: array(number()),
			scanned: number(),
			found: number(),
			excluded: number(),
			olderCopies: number(),
			failed: number(),
			issues: array(object({
				path: string(),
				category: _enum(["unsupported", "invalid"]),
				reason: string()
			}).strict())
		}).strict());
		var typert_remote_client_default = {
			package: "@eduwork/workbench-native",
			descriptors: [
				[
					"notificationView",
					[{
						name: "view",
						wire: "view",
						source: "json",
						codec: codec("NotificationView", object({
							sessionId: string().max(256),
							artifactId: string().max(256).optional(),
							openedKey: string().max(600).optional()
						}).strict())
					}],
					codec("NotificationState", object({
						desktop: boolean(),
						delivery: _enum(["available", "unavailable"]),
						target: object({
							key: string(),
							sessionId: string(),
							artifactId: string().optional()
						}).strict().nullable()
					}).strict())
				],
				[
					"inspectImport",
					[{
						name: "path",
						wire: "path",
						source: "json",
						codec: codec("ImportPath", string().min(1))
					}],
					importJob
				],
				[
					"cancelImport",
					[],
					importJob
				],
				[
					"importData",
					[{
						name: "path",
						wire: "path",
						source: "json",
						codec: codec("ImportPath", string().min(1))
					}],
					importJob
				],
				[
					"importStatus",
					[],
					importJob
				],
				[
					"catalog",
					[],
					codec("Catalog", object({ skills: array(row$1) }).strict())
				],
				[
					"desktop",
					[{
						name: "action",
						wire: "action",
						source: "json",
						codec: codec("Action", _enum([
							"status",
							"check-updates",
							"diagnostics",
							"download-update",
							"schedule-update",
							"install-update",
							"use-stable-updates",
							"use-development-updates",
							"download-content-update",
							"restart-content-update"
						]))
					}],
					codec("Desktop", object({
						shell: string(),
						phase: string(),
						message: string(),
						version: string().optional(),
						url: string().optional(),
						report: string().optional(),
						archive: string().optional(),
						filename: string().optional(),
						update,
						contentUpdate: update
					}).strict())
				]
			].map(([method, parameters, result]) => ({
				id: `${pkg$1}#workbench/${method}`,
				service: "workbench",
				namespace: "workbench",
				method,
				invocation: { kind: "direct" },
				parameters,
				result,
				sourceLocation: {
					file: "lib/index.js",
					line: 1,
					column: 1
				}
			}))
		};
		const h$4 = react.default.createElement;
		const accent = "var(--dsw-alias-state-business-primary, #3575ef)";
		const border$1 = "var(--dsw-alias-border-l2, #ddd)";
		const button = {
			padding: "8px 12px",
			border: `1px solid ${border$1}`,
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			color: "inherit",
			cursor: "pointer",
			fontSize: 13,
			whiteSpace: "nowrap"
		};
		const primary = {
			...button,
			background: accent,
			borderColor: accent,
			color: "#fff"
		};
		const secondary = "var(--dsw-alias-label-secondary, #777)";
		const note = {
			margin: "4px 0 0",
			color: secondary,
			fontSize: 12,
			lineHeight: 1.55
		};
		const row = {
			display: "flex",
			alignItems: "flex-start",
			justifyContent: "space-between",
			gap: 16
		};
		function createUpdateController(service) {
			let view = {
				status: null,
				open: false,
				error: "",
				working: ""
			}, timer, stopped = false, reading = false;
			const listeners = /* @__PURE__ */ new Set();
			const publish = (patch) => {
				view = {
					...view,
					...patch
				};
				listeners.forEach((fn) => fn());
			};
			const read = async () => {
				if (stopped || reading) return;
				reading = true;
				try {
					publish({ status: await service("status") });
				} catch (e) {
					publish({ error: e.message });
				} finally {
					reading = false;
				}
			};
			const poll = async () => {
				await read();
				if (!stopped) timer = setTimeout(poll, [view.status?.update?.state, view.status?.contentUpdate?.state].some((state) => [
					"checking",
					"downloading",
					"applying"
				].includes(state)) ? 350 : 2500);
			};
			const run = async (action) => {
				if (view.working) return;
				const started = Date.now(), working = action === "check-updates" ? "checking" : action === "download-update" ? "downloading" : action.startsWith("use-") ? "switching" : "";
				publish({
					error: "",
					working
				});
				try {
					const status = await service(action);
					publish({ status });
					if (status.phase === "error" && !status.update?.error) publish({ error: status.message });
				} catch (e) {
					publish({ error: e.message });
				} finally {
					if (working) await new Promise((resolve) => setTimeout(resolve, Math.max(0, 450 - (Date.now() - started))));
					await read();
					publish({ working: "" });
				}
			};
			poll();
			const open = () => {
				publish({ open: true });
				if (!["downloading", "ready"].includes(view.status?.contentUpdate?.state) && (!view.status?.update || [
					"idle",
					"installed",
					"up_to_date",
					"current",
					"error"
				].includes(view.status.update.state))) run("check-updates");
			};
			const event = () => open();
			window.addEventListener("eduwork:open-updates", event);
			return {
				subscribe: (fn) => {
					listeners.add(fn);
					return () => listeners.delete(fn);
				},
				getSnapshot: () => view,
				run,
				open,
				close: () => publish({ open: false }),
				dispose: () => {
					stopped = true;
					clearTimeout(timer);
					window.removeEventListener("eduwork:open-updates", event);
				}
			};
		}
		function useUpdates(controller) {
			return (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		}
		const percent = (s) => s?.totalBytes > 0 ? Math.min(100, Math.floor(s.downloadedBytes / s.totalBytes * 100)) : 0;
		const size = (n) => n < 1048576 ? Math.ceil(Math.max(0, n || 0) / 1024) + " KB" : (Math.max(0, n || 0) / 1048576).toFixed(1) + " MB";
		function ContentPanel({ controller, content: c, working }) {
			if (!c?.enabled) return null;
			const progress = percent(c);
			const message = c.state === "available" ? `发现内容更新 r${c.latestRevision} · ${size(c.totalBytes)}` : c.state === "checking" ? "正在检查内容更新…" : c.state === "downloading" ? "正在下载内容更新…" : c.state === "ready" ? "已下载并校验，下次启动生效。" : c.state === "requires_software" ? "此内容更新需要先升级到兼容的软件版本。" : c.state === "error" ? c.message : "当前内容已是最新版本";
			return h$4("div", {
				"data-eduwork-content-update": true,
				style: {
					marginTop: 16,
					paddingTop: 16,
					borderTop: `1px solid ${border$1}`
				}
			}, h$4("div", { style: { fontSize: 14 } }, c.configuration ? c.skills ? "配置与 Skills 更新" : "配置更新" : "Skills 更新"), h$4("p", { style: note }, [c.configuration && `配置 ${c.configurationRevision ? `r${c.configurationRevision}` : "随软件内置"}`, c.skills && `Skills ${c.skillsRevision ? `r${c.skillsRevision}` : "随软件内置"}`].filter(Boolean).join(" · ")), h$4("p", {
				role: c.state === "error" ? "alert" : "status",
				style: {
					...note,
					marginTop: 8,
					overflowWrap: "anywhere",
					...c.state === "error" ? { color: "var(--dsw-alias-state-error-primary, #a82332)" } : {}
				}
			}, message), c.message && c.state === "current" && h$4("p", { style: note }, c.message), c.state === "downloading" && h$4(react.default.Fragment, null, h$4("div", {
				role: "progressbar",
				"aria-label": "内容下载进度",
				"aria-valuemin": 0,
				"aria-valuemax": 100,
				"aria-valuenow": progress,
				style: {
					height: 6,
					marginTop: 10,
					borderRadius: 999,
					overflow: "hidden",
					background: border$1
				}
			}, h$4("div", { style: {
				width: `${progress}%`,
				height: "100%",
				background: accent
			} })), h$4("p", { style: note }, `${size(c.downloadedBytes)} / ${size(c.totalBytes)} · ${progress}%`)), ["available", "ready"].includes(c.state) && h$4("div", { style: {
				display: "flex",
				justifyContent: "flex-end",
				marginTop: 10
			} }, h$4("button", {
				type: "button",
				disabled: Boolean(working),
				style: primary,
				onClick: () => controller.run(c.state === "available" ? "download-content-update" : "restart-content-update")
			}, c.state === "available" ? "下载内容更新" : "重启使内容生效")), c.state === "ready" && h$4("p", { style: note }, "可以继续使用；重启前请先完成正在运行的任务。"));
		}
		function UpdatePanel({ controller }) {
			const { status, error, working } = useUpdates(controller), s = status?.update, c = status?.contentUpdate, state = working || s?.state || status?.phase;
			const busy = [
				"checking",
				"downloading",
				"applying",
				"switching"
			].includes(state);
			const enabled = status && status.shell !== "web" && (s?.enabled !== false || c?.enabled);
			const policy = s?.policy || c?.policy || "stable", locked = busy || state === "ready" || [
				"checking",
				"downloading",
				"ready"
			].includes(c?.state);
			const channels = [["stable", "仅公测版"], ["development", "开发版"]].filter(([value]) => !s?.nativeUI || s.policies?.includes(value));
			const setPolicy = async (value) => {
				if (locked || value === policy) return;
				await controller.run(value === "development" ? "use-development-updates" : "use-stable-updates");
				await controller.run("check-updates");
			};
			const progress = percent(s), determinate = state === "downloading" && s?.totalBytes > 0;
			const message = state === "available" ? `发现新版本 ${s.latestVersion}` : state === "downloading" ? `正在下载 ${s.latestVersion}` : state === "checking" ? "正在检查更新…" : state === "switching" ? "正在切换更新渠道…" : state === "applying" ? "正在退出并安装更新…" : state === "installed" ? "更新已完成" : state === "up_to_date" ? "当前已是最新版本" : null;
			return h$4("div", { "data-eduwork-update-panel": true }, h$4("div", { style: row }, h$4("div", { style: { minWidth: 0 } }, h$4("div", { style: { fontSize: 14 } }, s?.nativeUI ? "macOS 应用更新" : "自动更新"), h$4("p", { style: {
				...note,
				overflowWrap: "anywhere"
			} }, status?.version ? `当前版本 ${status.version}` : "读取当前版本…"), h$4("p", { style: note }, s?.nativeUI ? "点击检查后，在系统更新窗口确认下载与安装；配置和数据保留在用户目录。" : enabled ? "启动时在后台检查，发现新版本后在左下角提示。" : status ? "当前未启用自动更新。" : "正在读取更新状态…")), h$4("button", {
				type: "button",
				style: {
					...button,
					flexShrink: 0
				},
				disabled: locked || !enabled,
				onClick: () => controller.run("check-updates")
			}, state === "checking" ? "检查中…" : "检查更新")), enabled && s && channels.length > 1 && h$4(react.default.Fragment, null, h$4("div", {
				role: "radiogroup",
				"aria-label": "更新渠道",
				style: {
					display: "flex",
					gap: 8,
					marginTop: 12
				}
			}, ...channels.map(([value, label], index) => h$4("button", {
				key: value,
				type: "button",
				role: "radio",
				"aria-checked": policy === value,
				"aria-disabled": locked,
				tabIndex: policy === value ? 0 : -1,
				style: {
					...policy === value ? primary : {
						...button,
						background: "transparent"
					},
					cursor: locked ? "default" : "pointer",
					opacity: locked ? .7 : 1
				},
				onClick: () => setPolicy(value),
				onKeyDown: (e) => {
					if (locked || ![
						"ArrowLeft",
						"ArrowRight",
						"ArrowUp",
						"ArrowDown",
						"Home",
						"End"
					].includes(e.key)) return;
					e.preventDefault();
					const next = e.key === "Home" ? 0 : e.key === "End" ? 1 : 1 - index;
					e.currentTarget.parentElement.children[next].focus();
					setPolicy(channels[next][0]);
				}
			}, label))), h$4("p", { style: {
				...note,
				marginTop: 8
			} }, policy === "development" ? "接收开发版及更新的公测版。" : "仅接收公测版；切换渠道不会降级。")), message && s?.enabled !== false && h$4("div", { style: {
				...row,
				alignItems: "center",
				marginTop: 12
			} }, h$4("span", {
				role: "status",
				"aria-live": "polite",
				style: {
					fontSize: 12,
					color: secondary
				}
			}, message), state === "available" && s && h$4("button", {
				type: "button",
				style: primary,
				onClick: () => controller.run("download-update")
			}, "下载更新")), s?.enabled !== false && [
				"checking",
				"downloading",
				"applying"
			].includes(state) && h$4("div", null, h$4("style", null, "@keyframes eduwork-update-progress{from{transform:translateX(-100%)}to{transform:translateX(334%)}}[data-eduwork-update-indeterminate]{animation:eduwork-update-progress 1.4s linear infinite}@media(prefers-reduced-motion:reduce){[data-eduwork-update-indeterminate]{animation:none}}"), h$4("div", {
				role: "progressbar",
				"aria-label": state === "downloading" ? "更新下载进度" : "更新处理进度",
				"aria-valuemin": 0,
				"aria-valuemax": 100,
				...determinate ? { "aria-valuenow": progress } : {},
				style: {
					height: 6,
					marginTop: 10,
					overflow: "hidden",
					borderRadius: 999,
					background: border$1
				}
			}, h$4("div", {
				"data-eduwork-update-indeterminate": determinate ? void 0 : true,
				style: {
					width: determinate ? `${progress}%` : "30%",
					height: "100%",
					borderRadius: 999,
					background: accent,
					transition: determinate ? "width .2s ease" : void 0
				}
			})), state === "downloading" && h$4("div", { style: {
				...row,
				marginTop: 6,
				fontSize: 11,
				color: secondary,
				fontVariantNumeric: "tabular-nums"
			} }, h$4("span", { style: {
				minWidth: 0,
				overflowWrap: "anywhere"
			} }, s?.fileName || "正在下载发行包"), h$4("span", { style: { flexShrink: 0 } }, determinate ? `${size(s.downloadedBytes)} / ${size(s.totalBytes)} · ${progress}%` : "正在连接…")), state === "downloading" && h$4("p", { style: note }, "下载期间可以继续对话，关闭此面板不影响下载。")), state === "ready" && h$4("div", { style: {
				marginTop: 12,
				padding: 11,
				border: `1px solid ${border$1}`,
				borderRadius: 10
			} }, h$4("p", {
				role: "status",
				style: {
					margin: 0,
					fontSize: 12
				}
			}, s.installOnNextStart ? `版本 ${s.latestVersion} 已校验，将在下次启动时安装。` : `版本 ${s.latestVersion} 已下载并校验。`), h$4("p", { style: note }, "可继续使用当前版本。重启安装前，请先完成正在运行的任务。"), h$4("div", { style: {
				display: "flex",
				justifyContent: "flex-end",
				flexWrap: "wrap",
				gap: 8,
				marginTop: 10
			} }, !s.installOnNextStart && h$4("button", {
				type: "button",
				style: button,
				onClick: () => controller.run("schedule-update")
			}, "下次启动时安装"), h$4("button", {
				type: "button",
				style: primary,
				onClick: () => controller.run("install-update")
			}, "立即重启更新"))), !busy && (error || s?.error) && h$4("p", {
				role: "alert",
				style: {
					...note,
					marginTop: 12,
					color: "var(--dsw-alias-state-error-primary, #a82332)",
					overflowWrap: "anywhere"
				}
			}, error || s.error), h$4(ContentPanel, {
				controller,
				content: c,
				working
			}), status?.url && h$4("a", {
				href: status.url,
				target: "_blank",
				rel: "noopener noreferrer",
				style: {
					...button,
					display: "inline-block",
					marginTop: 12
				}
			}, "打开下载页面"));
		}
		function UpdateFooter({ controller, wide = true }) {
			const { status, open, working } = useUpdates(controller), s = status?.update, c = status?.contentUpdate, state = working || s?.state;
			(0, react.useEffect)(() => {
				if (!open) return;
				const key = (e) => {
					if (e.key === "Escape") controller.close();
				};
				window.addEventListener("keydown", key);
				return () => window.removeEventListener("keydown", key);
			}, [open]);
			if (!status || status.shell === "web") return null;
			const softwareVisible = s?.enabled && [
				"available",
				"downloading",
				"ready",
				"applying"
			].includes(state);
			const label = softwareVisible ? state === "available" ? "更新" : state === "downloading" ? `下载 ${percent(s)}%` : state === "ready" ? "重启更新" : "正在更新…" : c?.state === "downloading" ? `内容 ${percent(c)}%` : c?.state === "ready" ? "内容待生效" : "更新";
			const visible = wide && (softwareVisible || c?.enabled && [
				"available",
				"downloading",
				"ready",
				"requires_software"
			].includes(c.state));
			return h$4(react.default.Fragment, null, visible && h$4("button", {
				type: "button",
				"aria-label": "查看更新",
				title: "查看软件及内容更新",
				onClick: controller.open,
				"data-eduwork-update-entry": true,
				"data-chatecnu-update-prompt": softwareVisible ? state : c.state,
				style: {
					flex: "0 0 auto",
					alignSelf: "center",
					minWidth: 42,
					height: 28,
					margin: "4px 2px 4px 6px",
					border: 0,
					borderRadius: 999,
					padding: "0 11px",
					background: "var(--dsw-alias-state-info-primary, #4f78dd)",
					color: "white",
					cursor: "pointer",
					fontSize: 11,
					fontWeight: 700,
					whiteSpace: "nowrap",
					fontFamily: "system-ui, sans-serif"
				}
			}, label), open && (0, react_dom.createPortal)(h$4("div", {
				style: {
					position: "fixed",
					inset: 0,
					zIndex: 11e3,
					display: "grid",
					placeItems: "center",
					background: "rgba(0,0,0,.28)",
					backdropFilter: "blur(3px)"
				},
				onMouseDown: (e) => {
					if (e.target === e.currentTarget) controller.close();
				}
			}, h$4("section", {
				role: "dialog",
				"aria-modal": true,
				"aria-label": "更新",
				style: {
					boxSizing: "border-box",
					width: "min(480px, calc(100vw - 32px))",
					maxHeight: "calc(100vh - 48px)",
					overflowY: "auto",
					padding: 24,
					border: `1px solid ${border$1}`,
					borderRadius: 16,
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					color: "var(--dsw-alias-label-primary, #222)",
					boxShadow: "0 20px 70px #0003"
				}
			}, h$4("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				marginBottom: 18
			} }, h$4("h2", { style: {
				fontSize: 20,
				margin: 0
			} }, "更新"), h$4("button", {
				type: "button",
				"aria-label": "关闭更新面板",
				onClick: controller.close,
				style: button
			}, "×")), h$4(UpdatePanel, { controller }))), document.body));
		}
		const h$3 = react.default.createElement;
		function DataImportPanel({ service }) {
			const [job, setJob] = (0, react.useState)(null), [error, setError] = (0, react.useState)(""), [choosing, setChoosing] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let active = true, timer;
				const poll = async () => {
					try {
						const next = await service.status();
						if (active) setJob(next);
					} catch (e) {
						if (active) setError(e.message);
					} finally {
						if (active) timer = setTimeout(poll, 800);
					}
				};
				poll();
				return () => {
					active = false;
					clearTimeout(timer);
				};
			}, [service]);
			const start = async () => {
				setError("");
				setChoosing(true);
				try {
					const path = await service.pickDirectory();
					if (path) setJob(await service.preview(path));
				} catch (e) {
					setError(e.message);
				} finally {
					setChoosing(false);
				}
			};
			const confirm = async () => {
				setError("");
				setChoosing(true);
				try {
					setJob(await service.start(job.id));
				} catch (e) {
					setError(e.message);
				} finally {
					setChoosing(false);
				}
			};
			const cancel = async () => {
				setError("");
				try {
					setJob(await service.cancel());
				} catch (e) {
					setError(e.message);
				}
			};
			const scanning = job?.state === "scanning", busy = choosing || scanning || job?.state === "running", button = {
				padding: "8px 12px",
				border: "1px solid var(--dsw-alias-border-l2, #ddd)",
				borderRadius: 8,
				background: "var(--dsw-alias-bg-layer-1, white)",
				color: "inherit",
				cursor: "pointer"
			};
			return h$3("section", {
				"data-eduwork-data-import": true,
				style: {
					padding: "16px 0",
					borderBottom: "1px solid var(--dsw-alias-border-l2, #ddd)"
				}
			}, h$3("h3", { style: {
				fontSize: 14,
				margin: "0 0 12px"
			} }, "导入历史数据"), h$3("p", { style: {
				fontSize: 13,
				lineHeight: 1.7
			} }, "选择旧客户端的程序根目录（包含程序和 data 文件夹）。合并会话及程序目录内的工作区、附件；重复内容跳过，冲突会话保留为副本。请先退出旧客户端。"), h$3("button", {
				type: "button",
				disabled: busy,
				style: button,
				onClick: start
			}, scanning ? "正在检查…" : busy ? "正在处理…" : "选择旧客户端目录并检查"), job?.state === "ready" && h$3("div", { style: {
				display: "flex",
				gap: 8,
				marginTop: 12
			} }, h$3("button", {
				type: "button",
				disabled: busy || !job.total,
				style: button,
				onClick: confirm
			}, `导入 ${job.total} 个可读会话`), h$3("button", {
				type: "button",
				disabled: busy,
				style: button,
				onClick: cancel
			}, "取消")), (scanning || job?.state === "running") && h$3("progress", {
				"aria-label": scanning ? "兼容性检查进度" : "数据导入进度",
				max: (scanning ? job.found : job.total) || 1,
				...(scanning ? job.found : job.total) ? { value: scanning ? job.scanned : job.completed } : {},
				style: {
					display: "block",
					width: "100%",
					marginTop: 12,
					accentColor: "var(--dsw-alias-state-business-primary)"
				}
			}), job?.targetFormat > 0 && h$3("p", { style: { fontSize: 12 } }, `来源客户端：${job.sourceVersion || "未标注"}；发现会话格式：${job.formats.map((v) => `v${v}`).join("、") || "未识别"}；本机支持至 v${job.targetFormat}。兼容性以会话格式为准。`), job?.message && h$3("p", {
				role: job.state === "error" ? "alert" : "status",
				style: { fontSize: 13 }
			}, job.message), error && h$3("p", { role: "alert" }, error), job?.issues?.length > 0 && h$3("details", { open: job.state === "ready" }, h$3("summary", null, `无法导入（${job.issues.length} 项）`), h$3("ul", null, ...job.issues.map((row, i) => h$3("li", {
				key: i,
				style: {
					fontSize: 12,
					overflowWrap: "anywhere"
				}
			}, `${row.path}：${row.reason}`)))), job?.warnings?.length > 0 && h$3("details", null, h$3("summary", null, `导入说明（${job.warnings.length} 项）`), h$3("ul", null, ...job.warnings.map((text, i) => h$3("li", {
				key: i,
				style: {
					fontSize: 12,
					overflowWrap: "anywhere"
				}
			}, text)))), job?.state === "complete" && h$3("p", { style: { fontSize: 12 } }, "导入记录已保存。完成当前任务后重新打开客户端，即可查看导入的会话。"), h$3("p", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)"
			} }, "已有数据、模型配置和登录信息不变。跨机时，程序目录之外的项目文件需要另外复制。"));
		}
		const h$2 = react.default.createElement;
		function ConcurrencySettings({ scope }) {
			const snapshot = (0, react.useSyncExternalStore)((listener) => scope.subscribe(listener), () => scope.getSnapshot(), () => scope.getSnapshot());
			const limit = snapshot.value?.maxConcurrentRequests;
			const [draft, setDraft] = (0, react.useState)(""), [saving, setSaving] = (0, react.useState)(false), [error, setError] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				if (limit !== void 0) setDraft(String(limit));
			}, [limit]);
			const value = Number(draft), valid = draft.trim() !== "" && Number.isSafeInteger(value) && value >= 1 && value <= 64;
			const save = async () => {
				if (!valid || saving) return;
				setSaving(true);
				setError("");
				try {
					await scope.set("maxConcurrentRequests", value);
					const next = scope.getSnapshot();
					if (next.status !== "ready" || next.value?.maxConcurrentRequests !== value) throw Error("并发设置未保存，请重试。");
				} catch (e) {
					setError(e.message);
				} finally {
					setSaving(false);
				}
			};
			const control = {
				padding: "8px 12px",
				border: "1px solid var(--dsw-alias-border-l2, #ddd)",
				borderRadius: 8,
				background: "var(--dsw-alias-bg-layer-1, #fff)",
				color: "inherit",
				fontSize: 13
			};
			return h$2("section", {
				"data-eduwork-concurrency": true,
				style: {
					padding: "16px 0",
					borderBottom: "1px solid var(--dsw-alias-border-l2, #ddd)"
				}
			}, h$2("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "flex-start",
				gap: 16
			} }, h$2("div", null, h$2("div", { style: { fontSize: 14 } }, "模型请求总并发"), h$2("p", { style: {
				margin: "4px 0 0",
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)",
				lineHeight: 1.55
			} }, limit === void 0 ? "正在读取并发设置…" : `当前客户端的主会话和子代理共用上限，同时最多 ${limit} 个模型请求。`)), h$2("form", {
				style: {
					display: "flex",
					gap: 8,
					alignItems: "center"
				},
				onSubmit: (e) => {
					e.preventDefault();
					save();
				}
			}, h$2("input", {
				type: "number",
				min: 1,
				max: 64,
				step: 1,
				"aria-label": "模型请求总并发",
				value: draft,
				disabled: saving || limit === void 0,
				style: {
					...control,
					width: 64
				},
				onChange: (e) => setDraft(e.target.value)
			}), h$2("button", {
				type: "submit",
				disabled: saving || snapshot.status !== "ready" || !valid || value === limit,
				style: {
					...control,
					whiteSpace: "nowrap",
					cursor: "pointer"
				}
			}, saving ? "保存中…" : "保存"))), h$2("p", { style: {
				margin: "8px 0 0",
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)",
				lineHeight: 1.55
			} }, "超出的模型请求排队；代理任务数可以更多。保存后生效，已运行的请求会正常完成。"), error && h$2("p", {
				role: "alert",
				style: {
					fontSize: 12,
					color: "var(--dsw-alias-state-error-primary, #a82332)"
				}
			}, error));
		}
		const h$1 = react.default.createElement;
		const labels = {
			enabled: "桌面弹窗",
			attention: "需求确认与授权",
			completed: "任务完成",
			failed: "任务失败或受阻",
			studio: "Studio 成果完成",
			sound: "通知声音",
			preview: "显示会话与成果标题"
		};
		function NotificationSettings({ scope, status }) {
			const snapshot = (0, react.useSyncExternalStore)((listener) => scope.subscribe(listener), () => scope.getSnapshot(), () => scope.getSnapshot());
			const native = (0, react.useSyncExternalStore)(status.subscribe, status.getSnapshot, status.getSnapshot);
			const [saving, setSaving] = (0, react.useState)(""), [error, setError] = (0, react.useState)("");
			if (!native.desktop) return null;
			const save = async (key, value) => {
				setSaving(key);
				setError("");
				try {
					await scope.set(key, value);
					if (scope.getSnapshot().value?.[key] !== value) throw Error("通知设置未保存，请重试。");
				} catch (cause) {
					setError(cause.message);
				} finally {
					setSaving("");
				}
			};
			return h$1("section", {
				"data-eduwork-notifications": true,
				style: {
					padding: "16px 0",
					borderBottom: "1px solid var(--dsw-alias-border-l2)"
				}
			}, h$1("div", { style: { fontSize: 14 } }, "桌面通知"), h$1("p", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)",
				lineHeight: 1.6
			} }, "应用在后台运行时提醒；点击返回对应会话。关闭弹窗后，托盘仍保留待处理事项。"), h$1("div", { style: {
				display: "grid",
				gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
				gap: 8
			} }, ...Object.entries(labels).map(([key, label]) => h$1("label", {
				key,
				style: {
					display: "flex",
					alignItems: "center",
					gap: 8,
					minHeight: 32,
					fontSize: 13
				}
			}, h$1("input", {
				type: "checkbox",
				checked: snapshot.value?.[key] === true,
				disabled: Boolean(saving) || snapshot.writable !== true,
				onChange: (event) => {
					save(key, event.target.checked);
				}
			}), label))), h$1("p", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)",
				lineHeight: 1.6
			} }, "仅在应用仍运行时生效。系统通知权限或勿扰模式可能阻止弹窗；默认不显示内容预览。"), native.delivery === "unavailable" && h$1("p", {
				role: "status",
				style: { fontSize: 12 }
			}, "系统通知暂不可用，可从托盘查看待处理事项。"), error && h$1("p", {
				role: "alert",
				style: {
					fontSize: 12,
					color: "var(--dsw-alias-state-error-primary)"
				}
			}, error));
		}
		function installNotificationNavigation(ctx, invoke, environment = window) {
			let disposed = false, busy = false, timer, openedKey, navigation = 0, visibleArtifact;
			let snapshot = {
				desktop: false,
				delivery: "available"
			};
			const listeners = /* @__PURE__ */ new Set();
			const status = {
				getSnapshot: () => snapshot,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			};
			const current = () => ctx.sessions.list.getSnapshot().current ?? "";
			const poll = async () => {
				if (disposed || busy) return;
				busy = true;
				try {
					const result = await invoke({
						sessionId: current(),
						...openedKey ? { openedKey } : {},
						...visibleArtifact?.sessionId === current() ? { artifactId: visibleArtifact.artifactId } : {}
					});
					if (disposed) return;
					openedKey = void 0;
					if (snapshot.desktop !== result.desktop || snapshot.delivery !== result.delivery) {
						snapshot = {
							desktop: result.desktop,
							delivery: result.delivery
						};
						listeners.forEach((listener) => listener());
					}
					const target = result.target;
					if (target) {
						const ownNavigation = ++navigation;
						ctx.uiWorkspace.openSession(target.sessionId);
						if (target.artifactId) for (let attempt = 0; attempt < 20; attempt++) {
							await new Promise((resolve) => environment.setTimeout(resolve, 50));
							if (disposed || ownNavigation !== navigation || current() !== target.sessionId) return;
							try {
								ctx.get("sidebarRight").openTab("knowledge-studio", { params: { artifactId: target.artifactId } });
								break;
							} catch (error) {
								if (attempt === 19) throw error;
							}
						}
						openedKey = target.key;
					}
				} catch {} finally {
					busy = false;
					if (!disposed) {
						environment.clearTimeout(timer);
						timer = environment.setTimeout(poll, 1e3);
					}
				}
			};
			const focus = () => {
				poll();
			};
			const studioVisibility = (event) => {
				const value = event.detail;
				if (value?.sessionId !== current() || typeof value.artifactId !== "string" || !/^artifact_[a-f0-9]{32}$/.test(value.artifactId)) return;
				if (value.visible === true) visibleArtifact = {
					sessionId: value.sessionId,
					artifactId: value.artifactId
				};
				else if (value.visible === false && visibleArtifact?.artifactId === value.artifactId) visibleArtifact = void 0;
				focus();
			};
			const unsubscribe = ctx.sessions.list.subscribe(focus);
			environment.addEventListener("focus", focus);
			environment.addEventListener("eduwork:studio-visibility", studioVisibility);
			poll();
			return {
				status,
				close() {
					disposed = true;
					navigation++;
					environment.clearTimeout(timer);
					environment.removeEventListener("focus", focus);
					environment.removeEventListener("eduwork:studio-visibility", studioVisibility);
					unsubscribe();
					listeners.clear();
				}
			};
		}
		async function pickImportDirectory(workspace, bridge = globalThis.go?.main?.Startup) {
			return (typeof bridge?.PickDirectory === "function" ? await bridge.PickDirectory() : await workspace.pickDirectory()) || null;
		}
		const skillSummarySchema = object({
			name: string().min(1).max(64),
			description: string().min(1).max(1024),
			source: literal("personal")
		}).strict();
		const skillSummaryResult = Object.freeze({
			mode: "strict",
			typeSymbol: "@chatecnu-work/dsh-skill-manager-native#SkillSummary",
			schema: skillSummarySchema
		});
		const skillListResult = Object.freeze({
			mode: "strict",
			typeSymbol: "@chatecnu-work/dsh-skill-manager-native#SkillList",
			schema: object({ skills: array(skillSummarySchema) }).strict()
		});
		function jsonParameter(name, schema, typeSymbol) {
			return Object.freeze({
				name,
				wire: name,
				source: "json",
				codec: Object.freeze({
					mode: "strict",
					typeSymbol,
					schema
				})
			});
		}
		const createInputSchema = object({
			name: string().min(1).max(64),
			description: string().min(1).max(1024),
			instructions: string().min(1).max(262144)
		}).strict();
		const sourcePathSchema = string().min(1).max(4096);
		const skillNameSchema = string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
		const pkg = "@chatecnu-work/dsh-skill-manager-native";
		const source = {
			file: "dsh-plugins/skill-manager-native/lib/index.js",
			line: 1,
			column: 1
		};
		const descriptor = (method, parameters, result) => ({
			id: `${pkg}#skillManager/${method}`,
			service: "skillManager",
			namespace: "skillManager",
			method,
			invocation: { kind: "direct" },
			parameters,
			result,
			sourceLocation: source
		});
		const TYPERT_REMOTE = {
			package: pkg,
			descriptors: [
				descriptor("list", [], skillListResult),
				descriptor("create", [jsonParameter("input", createInputSchema, `${pkg}#CreateInput`)], skillSummaryResult),
				descriptor("importDirectory", [jsonParameter("sourcePath", sourcePathSchema, `${pkg}#SourcePath`)], skillSummaryResult),
				descriptor("trashPersonalSkill", [jsonParameter("name", skillNameSchema, `${pkg}#SkillName`)], skillSummaryResult)
			]
		};
		const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
		const SKILL_ALIASES = Object.freeze({
			documents: "artifact-documents",
			spreadsheets: "artifact-spreadsheets",
			presentations: "artifact-presentations",
			pdfs: "artifact-pdfs",
			"ecnu-tts": "artifact-speech",
			"video-creation": "artifact-video",
			"ecnu-imagegen": "artifact-images"
		});
		function canonicalSkillName(name) {
			return Object.hasOwn(SKILL_ALIASES, name) ? SKILL_ALIASES[name] : name;
		}
		function normalizeSkillNames(value) {
			if (!Array.isArray(value)) return [];
			return [...new Set(value.filter((name) => typeof name === "string" && SKILL_NAME.test(name)).map(canonicalSkillName))].sort();
		}
		function effectiveDisabledSkills(settings = {}) {
			const disabled = new Set(normalizeSkillNames(settings.disabled));
			const enabled = new Set(normalizeSkillNames(settings.enabled));
			for (const name of normalizeSkillNames(settings.defaultDisabled)) if (!enabled.has(name)) disabled.add(name);
			return disabled;
		}
		function skillToggleSettings(settings, name, enabled) {
			name = canonicalSkillName(name);
			const disabledNames = new Set(normalizeSkillNames(settings.disabled));
			const enabledNames = new Set(normalizeSkillNames(settings.enabled));
			if (enabled) {
				disabledNames.delete(name);
				enabledNames.add(name);
			} else {
				disabledNames.add(name);
				enabledNames.delete(name);
			}
			return {
				disabled: [...disabledNames].sort(),
				enabled: [...enabledNames].sort()
			};
		}
		const bundledSkillCatalog = Object.freeze([
			Object.freeze({
				name: "artifact-documents",
				group: "create",
				label: "Word 文档",
				description: "撰写和编辑报告、方案、通知等 Word 文档。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "artifact-pdfs",
				group: "research",
				label: "PDF 处理",
				description: "读取 PDF、合并文件、抽取页面，也可制作简单 PDF。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "artifact-presentations",
				group: "create",
				label: "PPT 演示文稿",
				description: "组织讲述思路，选择主题和版式，制作 PPTX。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "artifact-spreadsheets",
				group: "create",
				label: "Excel 表格",
				description: "整理数据、设置公式和格式，创建或编辑 XLSX。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "artifact-images",
				group: "create",
				label: "图像创作",
				description: "生成插图、海报与封面，并适配所需尺寸。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "artifact-speech",
				group: "create",
				label: "语音与转写",
				description: "生成朗读、旁白和音频，或将已有录音转写成文字。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "artifact-video",
				group: "create",
				label: "视频创作",
				description: "设计分镜、画面和动画，结合配音与字幕制作视频。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "knowledge-studio",
				group: "organize",
				label: "Studio 成果管理",
				description: "在 Studio 保存成果、归并同轮修改，查看和下载最终版本。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "browser",
				group: "research",
				label: "网页搜索与浏览",
				description: "查找互联网公开资料、阅读网页并操作网站。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "skill-creator",
				group: "assist",
				label: "技能创作",
				description: "将重复工作整理成可复用技能，创建或修改技能说明。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "ecnu-campus-search",
				group: "research",
				label: "华师大校内搜索",
				description: "查找华师大办事入口、政策、机构、人员和校园资讯。",
				requiresEnterprise: true
			}),
			Object.freeze({
				name: "eduwork-help",
				group: "assist",
				label: "产品使用帮助",
				description: "解答 EduWork 的安装、配置、使用和故障排查问题。",
				requiresEnterprise: false
			}),
			Object.freeze({
				name: "ui-ux-pro-max",
				group: "assist",
				label: "界面设计顾问",
				description: "设计和改进网页、应用的布局与交互；默认关闭。",
				requiresEnterprise: false
			})
		]);
		const skillGroups = Object.freeze([
			{
				id: "create",
				label: "内容创作"
			},
			{
				id: "research",
				label: "搜索与资料"
			},
			{
				id: "organize",
				label: "成果管理"
			},
			{
				id: "assist",
				label: "辅助工具"
			},
			{
				id: "custom",
				label: "个人与项目技能"
			}
		]);
		function skillCenterRows(catalog = [], settings = {}) {
			const disabled = effectiveDisabledSkills(settings), labels = new Map(bundledSkillCatalog.map((row) => [row.name, row])), rows = /* @__PURE__ */ new Map();
			for (const item of [...catalog].sort((a, b) => (a.source === "builtin" ? -1 : 1) - (b.source === "builtin" ? -1 : 1))) {
				const name = canonicalSkillName(item.name), existing = rows.get(name);
				if (existing) {
					if (item.source === "personal") existing.variants.push({
						...item,
						legacy: item.name !== name
					});
					continue;
				}
				const label = labels.get(name);
				rows.set(name, {
					...item,
					name,
					label: label?.label || name,
					description: label?.description || item.description,
					group: label?.group || "custom",
					enabled: !disabled.has(name),
					available: item.available !== false,
					variants: []
				});
			}
			return [...rows.values()];
		}
		const inject = [
			"slots",
			"remote",
			"remote.skills",
			"connection",
			"sessions",
			"settingsScope",
			"uiWorkspace"
		];
		const h = react.default.createElement;
		const color = "var(--dsw-alias-state-business-primary, #9f2636)";
		const border = "var(--dsw-alias-border-l2, #e1e4eb)";
		const panelStyle = Object.freeze({
			position: "fixed",
			inset: 0,
			zIndex: 1e4,
			display: "grid",
			placeItems: "center",
			background: "rgba(32, 24, 21, 0.30)",
			backdropFilter: "blur(4px)"
		});
		const cardStyle = Object.freeze({
			width: "min(460px, calc(100vw - 40px))",
			maxHeight: "calc(100vh - 48px)",
			overflow: "auto",
			border: `1px solid ${border}`,
			borderRadius: 16,
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			color: "var(--dsw-alias-label-primary, #222)",
			boxShadow: "0 22px 70px rgba(61, 35, 31, .18)",
			padding: 22,
			fontFamily: "system-ui, sans-serif"
		});
		const buttonStyle = Object.freeze({
			border: `1px solid ${border}`,
			borderRadius: 9,
			padding: "8px 12px",
			background: "#fffaf7",
			color: "#352622",
			cursor: "pointer",
			fontSize: 13
		});
		const primaryStyle = Object.freeze({
			...buttonStyle,
			background: color,
			borderColor: color,
			color: "white",
			fontWeight: 650
		});
		function SkillCenter({ service }) {
			const settings = (0, react.useSyncExternalStore)((listener) => service.settings.subscribe(listener), () => service.settings.getSnapshot(), () => service.settings.getSnapshot());
			const [catalog, setCatalog] = (0, react.useState)([]);
			const credentialReady = false;
			const [query, setQuery] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			const [createOpen, setCreateOpen] = (0, react.useState)(false);
			const [pendingRemoval, setPendingRemoval] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)({
				name: "",
				description: "",
				instructions: ""
			});
			const refresh = async () => {
				setCatalog(await service.list());
			};
			(0, react.useEffect)(() => {
				const report = (cause) => setError(cause instanceof Error ? cause.message : String(cause));
				const off = service.subscribeSession(() => {
					refresh().then(() => setError("")).catch(report);
				});
				refresh().then(() => setError("")).catch(report);
				return off;
			}, []);
			const skillSettings = settings.value ?? {};
			const disabled = Array.isArray(skillSettings.disabled) ? skillSettings.disabled : [];
			const enabled = Array.isArray(skillSettings.enabled) ? skillSettings.enabled : [];
			const defaultDisabled = Array.isArray(skillSettings.defaultDisabled) ? skillSettings.defaultDisabled : [];
			const normalizedQuery = query.trim().toLocaleLowerCase();
			const rows = (0, react.useMemo)(() => skillCenterRows(catalog, skillSettings, credentialReady).filter((row) => !normalizedQuery || `${row.label} ${row.name} ${row.description}`.toLocaleLowerCase().includes(normalizedQuery)), [
				catalog,
				credentialReady,
				disabled.join("\0"),
				enabled.join("\0"),
				defaultDisabled.join("\0"),
				normalizedQuery
			]);
			const toggle = async (row) => {
				const { disabled: nextDisabled, enabled: nextEnabled } = skillToggleSettings(skillSettings, row.name, !row.enabled);
				setBusy(row.name);
				setError("");
				try {
					await service.settings.set("disabled", nextDisabled);
					await service.settings.set("enabled", nextEnabled);
					const persisted = service.settings.getSnapshot();
					if (persisted.status !== "ready") throw new Error("技能设置未能保存，请检查当前连接后重试。");
					if (effectiveDisabledSkills(persisted.value).has(canonicalSkillName(row.name)) !== row.enabled) throw new Error("技能设置没有生效，请重试。");
					await refresh();
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy("");
				}
			};
			const importSkill = async () => {
				setBusy("import");
				setError("");
				setNotice("");
				try {
					const path = await service.pickDirectory();
					if (path === null) return;
					setNotice(`已导入技能“${(await service.importDirectory(path)).name}”。`);
					await refresh();
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy("");
				}
			};
			const createSkill = async (event) => {
				event.preventDefault();
				setBusy("create");
				setError("");
				setNotice("");
				try {
					const created = await service.create(draft);
					setDraft({
						name: "",
						description: "",
						instructions: ""
					});
					setCreateOpen(false);
					setNotice(`已创建技能“${created.name}”。`);
					await refresh();
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy("");
				}
			};
			const removeSkill = async () => {
				if (!pendingRemoval) return;
				const name = pendingRemoval.name;
				setBusy(`remove:${name}`);
				setError("");
				setNotice("");
				try {
					await service.remove(name);
					await service.settings.set("disabled", disabled.filter((value) => value !== name));
					await service.settings.set("enabled", enabled.filter((value) => value !== name));
					setPendingRemoval(null);
					setNotice(`已移除个人技能“${name}”。新会话将不再发现它。`);
					await refresh();
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy("");
				}
			};
			const header = h("div", { style: {
				marginBottom: 18,
				display: "flex",
				justifyContent: "space-between",
				alignItems: "flex-start",
				gap: 16
			} }, h("div", null, h("h3", { style: {
				margin: "0 0 5px",
				fontSize: 20
			} }, "技能"), h("p", { style: {
				margin: 0,
				color: "#75635c",
				fontSize: 13,
				lineHeight: 1.6
			} }, "按用途选择技能。在对话和 Studio 中创作，共用同一套制作与文件预览能力。")), h("div", { style: {
				display: "flex",
				gap: 8,
				flex: "none"
			} }, h("button", {
				type: "button",
				disabled: busy !== "",
				style: buttonStyle,
				onClick: importSkill
			}, busy === "import" ? "正在导入…" : "导入"), h("button", {
				type: "button",
				disabled: busy !== "",
				style: primaryStyle,
				onClick: () => {
					setError("");
					setNotice("");
					setCreateOpen(true);
				}
			}, "创建技能")));
			if (settings.status === "loading") return h("div", null, header, h("p", null, "正在读取技能设置…"));
			if (settings.status !== "ready") return h("div", null, header, h("p", { role: "alert" }, "当前连接无法维护技能设置。"));
			return h("div", { style: {
				width: "100%",
				maxWidth: 820
			} }, header, h("input", {
				type: "search",
				value: query,
				placeholder: "搜索技能",
				"aria-label": "搜索技能",
				onChange: (event) => setQuery(event.currentTarget.value),
				style: {
					boxSizing: "border-box",
					width: "100%",
					height: 38,
					border: `1px solid ${border}`,
					borderRadius: 9,
					padding: "0 12px",
					marginBottom: 14,
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					color: "var(--dsw-alias-label-primary, #222)"
				}
			}), error && h("p", {
				role: "alert",
				style: {
					color: "#a82332",
					fontSize: 12
				}
			}, error), notice && h("p", {
				role: "status",
				style: {
					color: "#357a55",
					fontSize: 12
				}
			}, notice), !service.hasSession() && h("p", { style: {
				color: "#8a766f",
				fontSize: 12
			} }, "打开一个项目后，还会显示该项目专属的技能。"), rows.length === 0 && h("p", { role: "status" }, "没有匹配的技能。"), ...skillGroups.filter((group) => rows.some((row) => row.group === group.id)).map((group) => h("section", {
				key: group.id,
				"aria-label": group.label,
				style: { marginBottom: 22 }
			}, h("h4", { style: {
				margin: "0 0 10px",
				fontSize: 14,
				color: "#66534d"
			} }, group.label), h("div", { style: {
				display: "grid",
				gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
				gap: 10
			} }, ...rows.filter((row) => row.group === group.id).map((row) => h("article", {
				key: row.name,
				"data-skill-name": row.name,
				style: {
					border: `1px solid ${border}`,
					borderRadius: 12,
					padding: 14,
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					opacity: row.available ? 1 : .72
				}
			}, h("div", { style: {
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "space-between",
				gap: 12
			} }, h("div", { style: { minWidth: 0 } }, h("strong", { style: {
				display: "block",
				fontSize: 14
			} }, row.label), h("code", { style: {
				display: "block",
				marginTop: 2,
				color: "#8a766f",
				fontSize: 11
			} }, row.name)), h("button", {
				type: "button",
				role: "switch",
				"aria-label": row.label,
				"aria-checked": row.enabled,
				disabled: busy !== "" || !settings.writable,
				onClick: () => toggle(row),
				style: {
					...buttonStyle,
					flex: "none",
					minWidth: 52,
					padding: "5px 9px",
					background: row.enabled ? color : "#f2ece8",
					color: row.enabled ? "white" : "#75635c",
					borderColor: row.enabled ? color : border
				}
			}, busy === row.name ? "…" : row.enabled ? "已开启" : "已关闭")), h("p", { style: {
				minHeight: 38,
				margin: "10px 0 8px",
				color: "#66534d",
				fontSize: 12,
				lineHeight: 1.55
			} }, row.description), h("div", { style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 8,
				color: "#8a766f",
				fontSize: 11
			} }, h("div", { style: {
				display: "flex",
				gap: 7,
				flexWrap: "wrap"
			} }, h("span", null, row.source === "builtin" ? "产品内置" : row.source === "personal" ? "个人技能" : row.source === "session" ? "会话可用" : "项目技能"), !row.available && h("span", { style: { color: "#a26b22" } }, row.requirement || "需要配置相应服务")), row.removable && h("button", {
				type: "button",
				disabled: busy !== "",
				onClick: () => {
					setError("");
					setNotice("");
					setPendingRemoval(row);
				},
				style: {
					...buttonStyle,
					flex: "none",
					padding: "4px 8px",
					borderColor: "#edc9cd",
					background: "#fff7f7",
					color: "#a82332",
					fontSize: 11
				}
			}, "移除")), row.variants.length > 0 && h("details", { style: {
				marginTop: 10,
				fontSize: 12,
				color: "#66534d"
			} }, h("summary", { style: { cursor: "pointer" } }, "已安装的自定义版本"), ...row.variants.map((variant) => h("div", {
				key: `${variant.source}:${variant.name}`,
				style: { marginTop: 10 }
			}, h("strong", null, variant.name), h("p", { style: {
				margin: "4px 0",
				lineHeight: 1.55
			} }, variant.legacy ? "旧名称已归并到此技能，当前内置版本优先。原文件保留供你管理。" : String(variant.description || "此技能的自定义说明。")), variant.source === "personal" && variant.removable === true && h("button", {
				type: "button",
				disabled: busy !== "",
				style: {
					...buttonStyle,
					padding: "4px 8px"
				},
				onClick: () => {
					setError("");
					setNotice("");
					setPendingRemoval(variant);
				}
			}, "移除个人版本"))))))))), createOpen && h("div", {
				style: panelStyle,
				role: "presentation",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget && busy !== "create") setCreateOpen(false);
				}
			}, h("form", {
				role: "dialog",
				"aria-modal": "true",
				"aria-label": "创建个人技能",
				style: cardStyle,
				onSubmit: createSkill
			}, h("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				gap: 12
			} }, h("div", null, h("div", { style: {
				color,
				fontSize: 11,
				fontWeight: 750,
				letterSpacing: ".08em"
			} }, "PERSONAL SKILL"), h("h2", { style: {
				margin: "5px 0 4px",
				fontSize: 22
			} }, "创建个人技能"), h("p", { style: {
				margin: 0,
				color: "#75635c",
				fontSize: 12,
				lineHeight: 1.55
			} }, "创建后立即进入 DSH 标准技能目录，可随时关闭。")), h("button", {
				type: "button",
				disabled: busy === "create",
				"aria-label": "关闭",
				onClick: () => setCreateOpen(false),
				style: {
					...buttonStyle,
					padding: "5px 9px"
				}
			}, "×")), h("label", { style: {
				display: "block",
				marginTop: 17,
				fontSize: 12,
				fontWeight: 650
			} }, "技能标识", h("input", {
				value: draft.name,
				required: true,
				maxLength: 64,
				pattern: "[a-z0-9]+(?:-[a-z0-9]+)*",
				placeholder: "例如 meeting-helper",
				onChange: (event) => setDraft({
					...draft,
					name: event.currentTarget.value
				}),
				style: {
					boxSizing: "border-box",
					display: "block",
					width: "100%",
					marginTop: 6,
					height: 38,
					border: `1px solid ${border}`,
					borderRadius: 9,
					padding: "0 10px",
					background: "white"
				}
			})), h("label", { style: {
				display: "block",
				marginTop: 13,
				fontSize: 12,
				fontWeight: 650
			} }, "用途说明", h("input", {
				value: draft.description,
				required: true,
				maxLength: 1024,
				placeholder: "说明它能做什么，以及什么时候应该使用",
				onChange: (event) => setDraft({
					...draft,
					description: event.currentTarget.value
				}),
				style: {
					boxSizing: "border-box",
					display: "block",
					width: "100%",
					marginTop: 6,
					height: 38,
					border: `1px solid ${border}`,
					borderRadius: 9,
					padding: "0 10px",
					background: "white"
				}
			})), h("label", { style: {
				display: "block",
				marginTop: 13,
				fontSize: 12,
				fontWeight: 650
			} }, "工作指令", h("textarea", {
				value: draft.instructions,
				required: true,
				rows: 8,
				placeholder: "写清楚 Agent 应遵循的步骤、边界和交付要求。",
				onChange: (event) => setDraft({
					...draft,
					instructions: event.currentTarget.value
				}),
				style: {
					boxSizing: "border-box",
					display: "block",
					resize: "vertical",
					width: "100%",
					marginTop: 6,
					border: `1px solid ${border}`,
					borderRadius: 9,
					padding: 10,
					background: "white",
					lineHeight: 1.55
				}
			})), error && h("p", {
				role: "alert",
				style: {
					margin: "13px 0 0",
					padding: 9,
					borderRadius: 8,
					background: "#fff0f0",
					color: "#a82332",
					fontSize: 12
				}
			}, error), h("div", { style: {
				marginTop: 18,
				display: "flex",
				justifyContent: "flex-end",
				gap: 8
			} }, h("button", {
				type: "button",
				disabled: busy === "create",
				style: buttonStyle,
				onClick: () => setCreateOpen(false)
			}, "取消"), h("button", {
				type: "submit",
				disabled: busy === "create",
				style: primaryStyle
			}, busy === "create" ? "正在创建…" : "创建")))), pendingRemoval && h("div", {
				style: panelStyle,
				role: "presentation",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget && busy === "") setPendingRemoval(null);
				}
			}, h("section", {
				role: "dialog",
				"aria-modal": "true",
				"aria-label": "移除个人技能",
				style: cardStyle
			}, h("div", { style: {
				color: "#a82332",
				fontSize: 11,
				fontWeight: 750,
				letterSpacing: ".08em"
			} }, "REMOVE PERSONAL SKILL"), h("h2", { style: {
				margin: "6px 0 8px",
				fontSize: 21
			} }, `移除“${pendingRemoval.label}”？`), h("p", { style: {
				margin: 0,
				color: "#66534d",
				fontSize: 13,
				lineHeight: 1.65
			} }, "该技能会移出 Agent 的个人技能目录，并保留在本地回收区。历史会话不受影响；已经注入当前会话的内容可能持续到新建会话。"), error && h("p", {
				role: "alert",
				style: {
					margin: "13px 0 0",
					padding: 9,
					borderRadius: 8,
					background: "#fff0f0",
					color: "#a82332",
					fontSize: 12
				}
			}, error), h("div", { style: {
				marginTop: 19,
				display: "flex",
				justifyContent: "flex-end",
				gap: 8
			} }, h("button", {
				type: "button",
				disabled: busy !== "",
				style: buttonStyle,
				onClick: () => setPendingRemoval(null)
			}, "取消"), h("button", {
				type: "button",
				disabled: busy !== "",
				onClick: removeSkill,
				style: {
					...primaryStyle,
					background: "#a82332",
					borderColor: "#a82332"
				}
			}, busy === `remove:${pendingRemoval.name}` ? "正在移除…" : "移除")))));
		}
		const unwrap = async (operation) => {
			const result = await operation;
			if (result?.ok) return result.value;
			throw new Error(result?.error?.message || "工作台服务暂时不可用");
		};
		function DesktopSettings({ service, controller }) {
			const [error, setError] = (0, react.useState)(""), [busy, setBusy] = (0, react.useState)(false), [message, setMessage] = (0, react.useState)("");
			const diagnostics = async () => {
				if (busy) return;
				setBusy(true);
				setError("");
				setMessage("");
				try {
					downloadDiagnosticArchive(await service("diagnostics"));
					setMessage("诊断包已生成，请查看下载目录。对话问题请同时导出该会话的 Session log。");
				} catch (e) {
					setError(e.message);
				} finally {
					setBusy(false);
				}
			};
			const section = {
				padding: "16px 0",
				borderBottom: "1px solid var(--dsw-alias-border-l2, #e1e4eb)"
			};
			const note = {
				margin: "4px 0 0",
				color: "var(--dsw-alias-label-secondary)",
				fontSize: 12,
				lineHeight: 1.55
			};
			return h(react.default.Fragment, null, h("section", { style: section }, h(UpdatePanel, { controller })), h("section", { style: section }, h("div", { style: {
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "space-between",
				gap: 16
			} }, h("div", { style: { minWidth: 0 } }, h("div", { style: { fontSize: 14 } }, "故障诊断"), h("p", { style: note }, "导出 ZIP 诊断包，包含组件版本、启动与更新信息、脱敏日志；会话正文需另行导出。")), h("button", {
				type: "button",
				disabled: busy,
				style: {
					...buttonStyle,
					flexShrink: 0,
					whiteSpace: "nowrap",
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					color: "inherit"
				},
				onClick: diagnostics
			}, busy ? "正在整理…" : "导出诊断")), message && h("p", {
				role: "status",
				style: {
					...note,
					marginTop: 10
				}
			}, message), error && h("p", {
				role: "alert",
				style: {
					...note,
					marginTop: 10,
					color: "var(--dsw-alias-state-error-primary, #a82332)",
					overflowWrap: "anywhere"
				}
			}, error)));
		}
		async function apply(ctx) {
			const unmount = await ctx.remote.$mount(typert_remote_client_default), unmountSkills = await ctx.remote.$mount(TYPERT_REMOTE);
			ctx.inject(["remote.workbench", "remote.skillManager"], (inner) => {
				const notifications = installNotificationNavigation(inner, (view) => unwrap(inner.remote.workbench.notificationView(view)));
				inner.on("dispose", () => notifications.close());
				const notificationScope = inner.settingsScope.bind({ namespace: "eduwork-notifications" });
				inner.slots.inject("settings.general.item", () => inner.slots.register({
					name: "settings.general.item",
					id: "eduwork-notifications",
					order: 19,
					inject: () => ({
						scope: notificationScope,
						status: notifications.status
					})
				}, NotificationSettings));
				const service = {
					settings: inner.settingsScope.bind({ namespace: "chatecnu-skills" }),
					hasSession: () => Boolean(inner.sessions.list.getSnapshot().current),
					subscribeSession: (fn) => inner.sessions.list.subscribe(fn),
					list: async () => {
						const result = await unwrap(inner.remote.workbench.catalog());
						const id = inner.sessions.list.getSnapshot().current;
						if (!id || !inner.remote.skills) return result.skills;
						const session = await unwrap(inner.remote.skills.list({ sessionId: id }));
						const known = new Set(result.skills.map((row) => canonicalSkillName(row.name)));
						return [...result.skills, ...session.skills.filter((row) => !known.has(canonicalSkillName(row.name))).map((row) => ({
							...row,
							source: "session",
							available: true,
							removable: false
						}))];
					},
					create: (input) => unwrap(inner.remote.skillManager.create(input)),
					importDirectory: (path) => unwrap(inner.remote.skillManager.importDirectory(path)),
					remove: (name) => unwrap(inner.remote.skillManager.trashPersonalSkill(name)),
					pickDirectory: () => pickImportDirectory(inner.uiWorkspace)
				};
				inner.slots.inject("settings.plugins.tab", () => inner.slots.register({
					name: "settings.plugins.tab",
					id: "skills",
					order: -20,
					label: "技能",
					inject: () => ({ service })
				}, SkillCenter));
				const desktop = (action) => unwrap(inner.remote.workbench.desktop(action)), updates = createUpdateController(desktop);
				const dataImport = {
					pickDirectory: () => pickImportDirectory(inner.uiWorkspace),
					preview: (path) => unwrap(inner.remote.workbench.inspectImport(path)),
					start: (id) => unwrap(inner.remote.workbench.importData(id)),
					cancel: () => unwrap(inner.remote.workbench.cancelImport()),
					status: () => unwrap(inner.remote.workbench.importStatus())
				};
				inner.on("dispose", () => updates.dispose());
				inner.slots.inject("sidebar.footer.action", () => inner.slots.register({
					name: "sidebar.footer.action",
					id: "eduwork-updates",
					order: 90,
					inject: () => ({ controller: updates })
				}, UpdateFooter));
				inner.slots.inject("settings.general.item", () => inner.slots.register({
					name: "settings.general.item",
					id: "eduwork-workbench",
					order: 16,
					inject: () => ({
						service: desktop,
						controller: updates
					})
				}, DesktopSettings));
				inner.slots.inject("settings.general.item", () => inner.slots.register({
					name: "settings.general.item",
					id: "eduwork-data-import",
					order: 17,
					inject: () => ({ service: dataImport })
				}, DataImportPanel));
				const concurrency = inner.settingsScope.bind({ namespace: "eduwork-concurrency" });
				inner.slots.inject("settings.general.item", () => inner.slots.register({
					name: "settings.general.item",
					id: "eduwork-concurrency",
					order: 18,
					inject: () => ({ scope: concurrency })
				}, ConcurrencySettings));
			});
			return async () => {
				await unmountSkills();
				await unmount();
			};
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
