// A SystemOne adapter, not a chat-completions provider. Keep protocol validation
// here; authentication belongs to the Host's OIDC/credentials services.
const MAX_RESPONSE_BYTES = 512 * 1024
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function fail(message) { throw new Error(message) }
function text(value, field, max = 8192) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${field}: expected non-empty text (at most ${max} characters)`)
  return value
}
function keys(value, allowed, field) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`${field}: unsupported fields`)
}
function json(value, limit, field) {
  let serialized
  try {
    serialized = JSON.stringify(value, (_key, item) => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || (typeof item === 'number' && !Number.isFinite(item))) fail('Not JSON')
      return item
    })
  } catch { fail(`${field}: expected finite, serializable JSON`) }
  if (!serialized || Buffer.byteLength(serialized) > limit) fail(`${field}: exceeds the plugin size limit`)
  return serialized
}

export function resolveDecisionConfig(raw = {}) {
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') fail('enabled must be boolean')
  if (!(raw.enabled ?? false)) return Object.freeze({ enabled: false })
  const base = new URL(text(raw.baseURL, 'baseURL', 2048))
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) || base.username || base.password || base.search || base.hash) fail('Decision baseURL must use HTTPS (HTTP is only allowed for local tests), without credentials, query or fragment')
  const timeout = raw.requestTimeoutMs ?? 60000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 195000) fail('requestTimeoutMs must be an integer in 1–195000')
  const authMode = raw.authMode ?? 'api-key'
  if (!['api-key', 'oidc', 'none'].includes(authMode)) fail('authMode must be api-key, oidc or none')
  const imageInput = raw.imageInput ?? 'none'
  if (!['none', 'data-uri'].includes(imageInput)) fail('imageInput must be none or data-uri')
  const maxQuestions = raw.maxQuestions ?? 32
  if (!Number.isSafeInteger(maxQuestions) || maxQuestions < 1 || maxQuestions > 512) fail('maxQuestions must be in 1–512 (client limit)')
  const maxRequestBytes = raw.maxRequestBytes ?? 65536
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 16 * 1024 * 1024) fail('maxRequestBytes must be in 1–16777216 (client limit)')
  return Object.freeze({
    enabled: true,
    baseURL: base.href.replace(/\/+$/, ''),
    model: text(raw.model, 'model', 128),
    authMode,
    oidcProfileId: authMode === 'oidc' ? text(raw.oidcProfileId, 'oidcProfileId', 128) : '',
    credentialRef: authMode === 'api-key' ? text(raw.credentialRef ?? 'SYSTEMONE_API_KEY', 'credentialRef', 512) : '',
    imageInput, maxQuestions, maxRequestBytes,
    requestTimeoutMs: timeout,
  })
}

export function decisionBody(args, config) {
  keys(args, ['state', 'questions', 'images'], 'decision arguments')
  if (typeof args.state !== 'string' && !object(args.state) && !Array.isArray(args.state)) fail('state must be text, a JSON object or array')
  if (!object(args.questions) || !Object.keys(args.questions).length || Object.keys(args.questions).length > config.maxQuestions) fail(`questions must contain 1–${config.maxQuestions} question IDs (configured client limit)`)
  for (const [id, question] of Object.entries(args.questions)) {
    text(id, 'question ID', 128)
    keys(question, ['type', 'instructions', 'criteria'], 'question')
    // Structured descriptions and null/omitted instructions are part of the
    // public contract. Individual servers may impose stricter requirements.
    const description = value => value === null || typeof value === 'string' || object(value) || Array.isArray(value)
    if (question.instructions !== undefined && !description(question.instructions)) fail('instructions must be text, structured JSON or null')
    if (question.type === 'score') {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10) fail('score.criteria must contain 2–10 ordered levels')
      if (!question.criteria.every(description)) fail('score criteria must contain text, structured JSON or null')
    } else if (question.type === 'choice' || question.type === 'noul') {
      if (question.type === 'choice' || question.criteria != null) {
        if (!object(question.criteria) || (question.type === 'choice' && !Object.keys(question.criteria).length)) fail('choice/noul.criteria must be an object; choice requires at least one label')
        for (const [label, description] of Object.entries(question.criteria)) {
          text(label, 'choice label', 128)
          if (question.type === 'noul' && !['true', 'false'].includes(label)) fail('noul.criteria only supports true and false keys')
          if (!(description === null || typeof description === 'string' || object(description) || Array.isArray(description))) fail('criterion must be text, structured JSON or null')
        }
      }
    } else fail('question.type must be choice, noul or score')
  }
  // This is a client payload bound, not a claim about the model's image limit.
  // Inline images only: no arbitrary URL fetching or implicit filesystem reads.
  if (args.images !== undefined) {
    if (config.imageInput !== 'data-uri') fail('This service has not enabled the images Data URI extension')
    if (!Array.isArray(args.images) || args.images.length > 8) fail('images must be an array with at most 8 inline images (plugin limit)')
    for (const image of args.images) {
      if (typeof image !== 'string' || !/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) fail('images must contain PNG/JPEG/WebP base64 Data URIs')
    }
  }
  return json({ model: config.model, ...args }, config.maxRequestBytes, 'request')
}

async function boundedJSON(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel(); fail('Decision response exceeds the plugin size limit')
  }
  const reader = response.body?.getReader()
  const parts = []; let size = 0
  try {
    if (reader) while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) fail('Decision response exceeds the plugin size limit')
      parts.push(value)
    }
  } catch (error) { await reader?.cancel().catch(() => {}); throw error }
  finally { reader?.releaseLock() }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) }
  catch { fail('Decision service returned invalid JSON') }
}

function probability(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 }
export function validateDecisionResult(result, questions, model) {
  if (!object(result) || !object(result.answers)) fail('Decision response is missing answers')
  if (result.gateway?.requested_model !== undefined && result.gateway.requested_model !== model) fail('Decision response requested_model does not match the configured model')
  if (Object.keys(result.answers).length !== Object.keys(questions).length) fail('Decision response question IDs do not match the request')
  for (const [id, question] of Object.entries(questions)) {
    const answer = Object.hasOwn(result.answers, id) ? result.answers[id] : undefined
    if (!object(answer) || answer.type !== question.type) fail('Decision response has a missing or mismatched answer type')
    // Some compatible servers abstain with null. Preserve it instead of
    // inventing a label or rejecting a legitimate no-choice result.
    if (question.type === 'choice' && answer.choice !== null && (typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria, answer.choice))) fail('Decision service returned an unknown choice label')
    if (question.type === 'noul' && !probability(answer.noul)) fail('Decision noul must be a probability between 0 and 1')
    if (question.type === 'score' && !(typeof answer.score === 'number' && Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= question.criteria.length - 1)) fail('Decision score is outside the requested scale')
    if (answer.confidence !== undefined && !probability(answer.confidence)) fail('Decision confidence must be between 0 and 1')
    if (answer.probabilities !== undefined && (!object(answer.probabilities) || !Object.values(answer.probabilities).every(probability))) fail('Decision probabilities are malformed')
  }
  // Retain probabilities, fractional scores, legends, usage and gateway metadata.
  // Do not silently turn noul into boolean or invent a business threshold.
  return result
}

export async function requestDecision({ config, args, fetchImpl, signal }) {
  const body = decisionBody(args, config)
  signal?.throwIfAborted()
  const response = await fetchImpl(`${config.baseURL}/systemone`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body, signal, redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel()
    // Never echo arbitrary error bodies (which may contain input or credentials).
    const hint = {
      401: '请检查服务凭据或机构登录；本次未自动重试 / Check credentials or sign-in; request not retried',
      403: '请确认当前身份具有该模型的调用权限 / Check model authorization for the calling identity',
      422: '服务端拒绝请求格式或模型名，请核对模型别名与接口版本 / Check request schema and deployed model alias',
      429: '服务限流或额度不足，请稍后检查 / Check rate limits or quota',
      504: '服务超时，上游可能仍在运行；不要盲目重试 / Upstream may still be running; do not blindly retry',
    }[response.status] ?? '请检查服务状态或接口配置 / Check the service and configuration'
    fail(`Decision HTTP ${response.status}: ${hint}`)
  }
  return validateDecisionResult(await boundedJSON(response), args.questions, config.model)
}
