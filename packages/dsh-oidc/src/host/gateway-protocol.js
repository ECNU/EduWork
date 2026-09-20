import { detectGatewayProtocol as detectLiteLLM, protocolError } from './litellm-protocol.js'
import { detectOidcLlm } from './oidc-llm-protocol.js'
export function detectGatewayProtocol(raw, profile) {
  if (profile.auth.experimentalOidcLlm && !Object.hasOwn(raw, 'oidc_llm')) throw protocolError('gateway_protocol_unsupported', 'Configured oidc-llm authorization cannot fall back to another gateway protocol')
  return Object.hasOwn(raw, 'oidc_llm') ? detectOidcLlm(raw, profile) : detectLiteLLM(raw, profile)
}
