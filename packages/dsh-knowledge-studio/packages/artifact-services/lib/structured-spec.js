// Prefer a JSON object at the tool boundary; retain the legacy string without
// guessing how escaping was intended (paths and document text may contain it).
export function structuredSpec(args,maximum=1024*1024) {
  if(args.spec!==undefined&&args.spec_json!==undefined)throw new Error('Provide spec or spec_json, not both')
  let value=args.spec
  if(value===undefined) {
    if(typeof args.spec_json!=='string')throw new Error('Provide spec as a JSON object (legacy spec_json string is also supported)')
    if(args.spec_json.length>maximum)throw new Error('spec_json is too long')
    try {value=JSON.parse(args.spec_json)} catch {throw new Error('spec_json must contain valid JSON; pass spec as an object to avoid double escaping')}
  }
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('spec must contain one JSON object; do not JSON-encode it twice')
  let json
  try {json=JSON.stringify(value)} catch {throw new Error('spec must be JSON serializable')}
  if(json.length>maximum)throw new Error('spec is too long')
  return JSON.parse(json)
}
