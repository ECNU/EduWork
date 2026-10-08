/**
 * BM25 title ranking over a small corpus for the literature seam: used to
 * rerank merged search candidates by how well each title matches a title
 * query, because the sources order their results by their own criteria (dblp
 * by year, arXiv by relevance) rather than by title similarity.
 * @module @eduwork/dsh-literature/core/bm25
 */

/** BM25 term-frequency saturation. */
const K1 = 1.5
/** BM25 document-length normalization. */
const B = 0.75

/** CJK scripts, which are written without inter-word spaces. */
const CJK_SCRIPT = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u

/**
 * Tokenize one normalized title. Space-separated words pass through; a word
 * containing CJK characters (which carry no inter-word spaces) is split into
 * overlapping character bigrams, so Chinese and Japanese titles still match a
 * query by character coverage.
 * @param text - the normalized title or query.
 * @returns the terms.
 */
export function tokenizeTitle(text: string): string[] {
  return text.split(' ').filter(word => word.length > 0).flatMap((word) => {
    if (!CJK_SCRIPT.test(word)) return [word]
    const chars = Array.from(word)
    if (chars.length <= 1) return [word]
    const bigrams: string[] = []
    for (let index = 0; index < chars.length - 1; index++) {
      bigrams.push(chars.slice(index, index + 2).join(''))
    }
    return bigrams
  })
}

/**
 * Rank a corpus of title strings against a query title with BM25, where the
 * corpus itself supplies the document frequencies. Short-title corpora are
 * the intended input, so term frequency is binary in practice and the score
 * mostly reflects query-term coverage weighted by how rare each term is.
 * @param titles - the candidate titles, already normalized.
 * @param query - the query title, already normalized.
 * @returns one score per title, in the input order; higher is a better match.
 */
export function bm25TitleScores(titles: readonly string[], query: string): number[] {
  const queryTerms = tokenizeTitle(query)
  if (queryTerms.length === 0 || titles.length === 0) return titles.map(() => 0)
  const tokenized = titles.map(title => tokenizeTitle(title))
  const docFreq = new Map<string, number>()
  for (const terms of tokenized) {
    for (const term of new Set(terms)) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
  }
  const avgLength = tokenized.reduce((sum, terms) => sum + terms.length, 0) / tokenized.length
  if (avgLength === 0) return titles.map(() => 0)
  const idf = (term: string): number => {
    const df = docFreq.get(term) ?? 0
    return Math.log(1 + (titles.length - df + 0.5) / (df + 0.5))
  }
  return tokenized.map((terms) => {
    const length = terms.length
    const termFreq = new Map<string, number>()
    for (const term of terms) termFreq.set(term, (termFreq.get(term) ?? 0) + 1)
    let score = 0
    for (const term of queryTerms) {
      const tf = termFreq.get(term) ?? 0
      if (tf === 0) continue
      const denominator = tf + K1 * (1 - B + B * (length / avgLength))
      score += idf(term) * ((tf * (K1 + 1)) / denominator)
    }
    return score
  })
}
