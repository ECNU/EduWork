const itemKeys={quiz:'questions',flashcards:'cards',report:'sections',mindmap:'nodes',table:'rows',slides:'slides',audio:'segments',video:'scenes'}

/** One request owns one exact label map. Stored artifacts and public APIs keep
 * canonical evidence IDs; neither fuzzy matching nor a global label cache is used. */
export function createEvidenceBundle(input,{maxCharacters=56000}={}) {
  if(!Number.isSafeInteger(maxCharacters)||maxCharacters<=0)throw new Error('Invalid evidence bundle limit')
  const labels=new Map(),seen=new Set(),evidence=[],blocks=[]
  let length=0
  for(const item of input) {
    const id=item?.evidenceId
    if(typeof id!=='string'||!id)throw new Error('来源缺少有效标识')
    if(seen.has(id))continue
    const label=`S${labels.size+1}`
    const block=[
      `Evidence ID: ${label}`,
      `Source: ${item.path}`,
      `Location: ${item.locator==='page'?`pages ${item.pageStart}-${item.pageEnd}`:`lines ${item.lineStart}-${item.lineEnd}`}`,
      `Heading: ${item.heading??''}`,
      String(item.content??'').slice(0,1600),
    ].join('\n')
    const nextLength=length+block.length+(blocks.length?7:0)
    // Do not authorize a label whose source block was cut out of the prompt.
    if(nextLength>maxCharacters)break
    labels.set(label,id);seen.add(id);evidence.push(item);blocks.push(block);length=nextLength
  }
  if(!evidence.length)throw new Error('当前请求没有可容纳的来源片段')
  return {text:blocks.join('\n\n---\n\n'),evidence,labels:Object.fromEntries(labels),
    restore(kind,raw) {
      if(typeof raw!=='string'||raw.length>2000000)throw new Error('成果 JSON 超过解析上限，原始草稿已保留')
      const parsed=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))
      const key=itemKeys[kind]
      if(!key||!parsed||!Array.isArray(parsed[key]))throw new Error('模型未返回有效成果内容')
      for(const item of parsed[key]) {
        if(!item||typeof item!=='object'||Array.isArray(item))continue
        // Provenance is optional. Keep exact known labels only; never guess a
        // nearby label or manufacture a reference to make an item exportable.
        item.evidenceIds=[...new Set((Array.isArray(item.evidenceIds)?item.evidenceIds:[]).filter(label=>labels.has(label)).map(label=>labels.get(label)))]
      }
      return JSON.stringify(parsed)
    },
  }
}
