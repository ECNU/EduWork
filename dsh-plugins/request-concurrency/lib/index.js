export const name = 'eduwork-request-concurrency'
export const inject = ['llm', 'settings']
export const SETTINGS_NAMESPACE = 'eduwork-concurrency'
export const DEFAULT_REQUEST_LIMIT = 3
export const MAX_REQUEST_LIMIT = 64

function validateLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REQUEST_LIMIT) throw new Error('模型请求总并发必须为 1–64 的整数')
  return limit
}

export function configuredRequestLimit(config = {}, environment = process.env) {
  if (environment.EDUWORK_MAX_CONCURRENT_REQUESTS !== undefined) return validateLimit(Number(environment.EDUWORK_MAX_CONCURRENT_REQUESTS))
  if (environment.EDUWORK_MAX_PARALLEL_SUBAGENTS !== undefined) return legacyRequestLimit(Number(environment.EDUWORK_MAX_PARALLEL_SUBAGENTS))
  if (config.maxConcurrentRequests !== undefined) return validateLimit(config.maxConcurrentRequests)
  return config.maxParallelSubagents === undefined ? DEFAULT_REQUEST_LIMIT : legacyRequestLimit(config.maxParallelSubagents)
}

function legacyRequestLimit(children) {
  if (!Number.isSafeInteger(children) || children < 1 || children > 32) throw new Error('maxParallelSubagents must be an integer between 1 and 32')
  return children + 1
}

export class RequestSlots {
  constructor(limit) { this.limit=validateLimit(limit); this.active=0; this.waiters=[]; this.closed=false }
  acquire(signal) {
    if(this.closed)return Promise.reject(new Error('模型请求队列已关闭'))
    if(signal?.aborted)return Promise.reject(signal.reason)
    return new Promise((resolve,reject)=>{
      const entry={grant:()=>{
        signal?.removeEventListener('abort',abort)
        this.active++
        let released=false
        resolve(()=>{if(released)return;released=true;this.active--;this.drain()})
      },reject,abort:()=>signal?.removeEventListener('abort',abort)}
      const abort=()=>{const i=this.waiters.indexOf(entry);if(i>=0)this.waiters.splice(i,1);reject(signal.reason)}
      signal?.addEventListener('abort',abort,{once:true})
      this.waiters.push(entry);this.drain()
    })
  }
  drain(){while(!this.closed&&this.active<this.limit&&this.waiters.length)this.waiters.shift().grant()}
  setLimit(limit){this.limit=validateLimit(limit);this.drain()}
  close(){this.closed=true;for(const entry of this.waiters.splice(0)){entry.abort();entry.reject(new Error('模型请求队列已关闭'))}}
}

// All Host LLM streams share one FIFO, including root sessions, subagents,
// compaction and auxiliary requests. Release before tools/descendants run;
// holding a slot for an entire agent turn would deadlock nested delegation.
export function installConcurrency(ctx,totalLimit) {
  const requests=new RequestSlots(totalLimit)
  ctx.effect(()=>()=>requests.close())
  ctx.on('llm/stream',async function*(options,next){
    const release=await requests.acquire(options.signal)
    try {options.signal?.throwIfAborted();yield*next()} finally {release()}
  })
  return limit=>requests.setLimit(limit)
}

export async function apply(ctx,config={}) {
  const {default:z}=await import('@deepseek-ai/schemastery')
  const totalLimit=configuredRequestLimit(config)
  const scope=ctx.settings.register(SETTINGS_NAMESPACE,z.object({
    maxConcurrentRequests:z.number().step(1).min(1).max(MAX_REQUEST_LIMIT).default(DEFAULT_REQUEST_LIMIT),
    maxParallelSubagents:z.number().step(1).min(1).max(32).hidden(),
  }),{base:{maxConcurrentRequests:totalLimit},applies:'live'})
  // Read the official user layer, not the resolved default: an old saved 2
  // means 3 total even if the new assembly supplies a different default.
  const previous=ctx.settings.describe().find(entry=>entry.ns===SETTINGS_NAMESPACE)
  if (previous?.user?.maxParallelSubagents !== undefined) {
    const ops=[{op:'unset',path:['maxParallelSubagents']}]
    if (previous.user.maxConcurrentRequests === undefined) ops.unshift({op:'set',path:['maxConcurrentRequests'],value:legacyRequestLimit(previous.user.maxParallelSubagents)})
    await ctx.settings.mutate(SETTINGS_NAMESPACE,ops,previous.revision)
  }
  const setLimit=installConcurrency(ctx,scope.get().maxConcurrentRequests)
  ctx.effect(()=>scope.watch(next=>setLimit(next.maxConcurrentRequests)))
}
