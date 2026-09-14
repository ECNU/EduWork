import contract from '../contracts/presentation-metrics.json' with {type:'json'}

export const PRESENTATION_METRICS = Object.freeze({...contract})

// Keep formatting exactly as supplied, including spaces around comparisons.
export function validateMetricValue(value) {
  if(typeof value!=='string'||!value.trim())throw new Error('指标值必须是非空文本')
  if(/[\r\n\t\v\f\u0085\u2028\u2029]/u.test(value))throw new Error('指标值必须是单行文本')
  if(Array.from(value).length>PRESENTATION_METRICS.maximumValueCharacters)throw new Error(`指标值最多 ${PRESENTATION_METRICS.maximumValueCharacters} 字符，完整草稿已保留；请将长解释移到说明或讲稿`)
  return value
}
