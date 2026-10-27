// Pure helpers for the post-answer retitle pass: a title-only system prompt,
// the labeled question/answer input with per-part budgets, and defensive
// normalization of whatever the model returns.

export const TITLE_QUESTION_MAX = 400
export const TITLE_ANSWER_MAX = 1200
export const TITLE_INPUT_MAX = 4000
export const TITLE_MAX_BYTES = 60

/** OS command escape sequences, including an unterminated tail. */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
/** Control-sequence-introducer escapes such as SGR color codes. */
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
/** Remaining two-byte ESC control sequences. */
const ESC_SEQUENCE = /\u001B[@-_]/gu
/** Non-whitespace C0/C1 control characters. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
/** Directional and invisible controls that can make a title misleading. */
const DIRECTIONAL_CONTROL = /[​‎‏‪-‮⁠-⁤⁦-⁯﻿]/gu

const COPY = {
  zh: {
    system: [
      '你是会话标题生成助手：根据下面的「问题 + 回答」提炼一个极简标题。',
      '严格只输出标题本身，遵守：',
      '1. 纯文本单行，禁止引号、Markdown、XML、解释、前后缀、换行或终端控制码；',
      '2. 使用问题与回答的语言；',
      '3. 不超过 15 个汉字（非中文语言约 6 个词以内）；',
      '4. 直接给主题短语，不要开场白、自我陈述或任务复述。',
    ].join('\n'),
    question: '问题：',
    answer: '回答：',
  },
  en: {
    system: [
      'You name sessions: distill the question and answer below into a minimal title.',
      'Output ONLY the title. Rules:',
      '1. Plain single-line text; no quotes, Markdown, XML, explanations, prefixes, line breaks or terminal control codes;',
      '2. Use the language of the question and answer;',
      '3. At most ~15 CJK characters or 6 words;',
      '4. Give the subject phrase directly, without an opening remark or task recap.',
    ].join('\n'),
    question: 'Question: ',
    answer: 'Answer: ',
  },
}

function copyOf(locale) {
  return COPY[locale === 'en' ? 'en' : 'zh']
}

/** Bound a string to `max` characters with an ellipsis. */
export function bound(input, max) {
  return input.length <= max ? input : `${input.slice(0, max)}…`
}

/** System prompt for the title pass in the requested locale. */
export function titleSystem(locale) {
  return copyOf(locale).system
}

/** UTF-8 byte length of a string. */
function utf8Length(input) {
  return new TextEncoder().encode(input).length
}

/** Truncate to a UTF-8 byte budget without splitting a code point. */
export function truncateUtf8(input, maxBytes) {
  if (utf8Length(input) <= maxBytes) return input
  let used = 0
  let output = ''
  for (const character of input) {
    const bytes = utf8Length(character)
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

/** Strip control sequences, collapse whitespace, enforce the byte budget. */
export function normalizeTitle(input, maxBytes = TITLE_MAX_BYTES) {
  if (typeof input !== 'string') return ''
  const cleaned = input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return truncateUtf8(cleaned, maxBytes).trimEnd()
}

/** Build the labeled question/answer input with per-part and whole budgets. */
export function buildTitleInput(question, answer, locale) {
  const copy = copyOf(locale)
  const parts = []
  if (question.trim() !== '') parts.push(`${copy.question}${bound(question, TITLE_QUESTION_MAX)}`)
  if (answer.trim() !== '') parts.push(`${copy.answer}${bound(answer, TITLE_ANSWER_MAX)}`)
  return bound(parts.join('\n'), TITLE_INPUT_MAX)
}

/** Join the text blocks of one content array, skipping reasoning/tool noise. */
export function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Semantic text of one session event ('' when it carries no text). */
export function textOfEvent(event) {
  if (event?.type === 'user/message') {
    const kind = event.data?.source?.kind
    if (kind !== undefined && kind !== 'user') return ''
    return textOfBlocks(event.data?.content)
  }
  if (event?.type === 'assistant/message') return textOfBlocks(event.data?.message?.content)
  return ''
}

/** Fold events into the first question and every settled answer text. */
export function questionAndAnswerOf(events) {
  const question = events
    .filter(event => event?.type === 'user/message')
    .map(textOfEvent)
    .filter(text => text.trim() !== '')
    .join(' / ')
  const answer = events
    .filter(event => event?.type === 'assistant/message')
    .map(textOfEvent)
    .filter(text => text.trim() !== '')
    .join('\n')
  return { question, answer }
}
