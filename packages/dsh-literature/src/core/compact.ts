/**
 * Drop `undefined`-valued keys from an object literal so it satisfies the
 * repository's `exactOptionalPropertyTypes` when optional fields are absent.
 * @module @eduwork/dsh-literature/core/compact
 */

/** `T` with every property's `undefined` removed from its type. */
export type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> }

/**
 * Mutate and return `value` with every `undefined`-valued own key deleted.
 * @param value - the object literal to compact in place.
 * @returns the same object, typed as {@link Defined}.
 */
export function compact<T extends object>(value: T): Defined<T> {
  for (const key of Object.keys(value)) {
    if ((value as Record<string, unknown>)[key] === undefined) Reflect.deleteProperty(value, key)
  }
  return value as unknown as Defined<T>
}
