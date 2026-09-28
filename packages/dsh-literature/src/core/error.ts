/**
 * The closed {@link LiteratureError} taxonomy: every literature failure maps to
 * one structured code a direct caller (the model-facing tool) routes on.
 * @module @eduwork/dsh-literature/core/error
 */

/** Closed union of literature failure codes. */
export type LiteratureErrorCode =
  | 'LITERATURE_NO_RESULT'
  | 'LITERATURE_INVALID_REF'
  | 'LITERATURE_PROVIDER_UNAVAILABLE'
  | 'LITERATURE_FETCH_FAILED'
  | 'LITERATURE_FULLTEXT_UNAVAILABLE'
  | 'LITERATURE_EXTRACTION_FAILED'
  | 'LITERATURE_RATE_LIMITED'

/** Structured error thrown by the literature seam. */
export class LiteratureError extends Error {
  constructor(
    message: string,
    readonly code: LiteratureErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'LiteratureError'
  }
}
