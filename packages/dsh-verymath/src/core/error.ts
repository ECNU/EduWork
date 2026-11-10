/**
 * Structured error type for the VeryMath capability seam.
 * @module @eduwork/dsh-verymath/core
 */

/** Machine-readable error codes carried by every {@link VeryMathError}. */
export type VeryMathErrorCode =
  | 'VERYMATH_GLOSSARY_UNAVAILABLE'
  | 'VERYMATH_GLOSSARY_INVALID'
  | 'VERYMATH_PAPER_INVALID'
  | 'VERYMATH_PYTHON_UNAVAILABLE'
  | 'VERYMATH_SAGE_CORPUS_MISSING'
  | 'VERYMATH_IO'

/**
 * Error with a stable code from the {@link VeryMathErrorCode} taxonomy.
 * The seam routes on `code`, so a duplicated package copy must still be
 * recognizable by `name` plus the `code` field.
 */
export class VeryMathError extends Error {
  /** Stable machine-readable code. */
  readonly code: VeryMathErrorCode

  constructor(message: string, code: VeryMathErrorCode, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'VeryMathError'
    this.code = code
  }
}

/** Whether a value looks like a {@link VeryMathError}, even from a duplicated package copy. */
export function isVeryMathError(error: unknown): error is VeryMathError {
  return error instanceof VeryMathError || (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'VeryMathError' &&
    typeof (error as { code?: unknown }).code === 'string'
  )
}

/**
 * Whether an error carries a specific Node filesystem `code` such as `ENOENT`.
 * Callers use this to tell "the document does not exist yet" apart from every
 * other I/O failure (permissions, I/O, too many open files), which must not be
 * mistaken for an empty starting document.
 */
export function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
}
