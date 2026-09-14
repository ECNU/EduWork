const HAN = /\p{Script=Han}/u
const WORD = /[\p{L}\p{N}_-]/u

function pushHan(tokens, run) {
  if (!run) return
  const chars = [...run]
  tokens.push(...chars)
  for (let index = 0; index < chars.length - 1; index += 1) {
    tokens.push(chars[index] + chars[index + 1])
  }
}

function pushWord(tokens, run) {
  if (!run) return
  const original = String(run).normalize('NFKC')
  const whole = original.toLocaleLowerCase('en-US')
  tokens.push(whole)
  const parts = original
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_-]+|\s+/)
    .map(part => part.toLocaleLowerCase('en-US'))
    .filter(Boolean)
  if (parts.length > 1) tokens.push(...parts)
}

/**
 * Deterministic, dependency-free tokenizer for local workspace search.
 * Chinese runs become overlapping bigrams; other Unicode words are lower-cased.
 */
export function tokenize(input) {
  const normalized = String(input ?? '').normalize('NFKC')
  const tokens = []
  let hanRun = ''
  let wordRun = ''

  const flushHan = () => {
    pushHan(tokens, hanRun)
    hanRun = ''
  }
  const flushWord = () => {
    pushWord(tokens, wordRun)
    wordRun = ''
  }

  for (const char of normalized) {
    if (HAN.test(char)) {
      flushWord()
      hanRun += char
    } else if (WORD.test(char)) {
      flushHan()
      wordRun += char
    } else {
      flushHan()
      flushWord()
    }
  }
  flushHan()
  flushWord()
  return tokens.filter(token => token.length > 0)
}

export function tokenCounts(input) {
  const counts = new Map()
  for (const token of tokenize(input)) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}
