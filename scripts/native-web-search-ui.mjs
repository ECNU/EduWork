// Preserve the upstream form and API settings. Turning the explicit API switch
// off restores the deployment's provider instead of hardcoding DeepSeek login.
export function adaptNativeWebSearchUI(source) {
  const replace=(before,after)=>{
    if(source.split(before).length!==2)throw new Error('Native search UI anchor changed: '+before)
    source=source.replace(before,after)
  }
  replace('const target = PROVIDERS[field][enabled ? "api" : "messages"];',
    'const target = enabled ? PROVIDERS[field].api : (base?.[field] && base[field] !== PROVIDERS[field].api ? base[field] : PROVIDERS[field].messages);')
  replace('Off by default: search runs through DeepSeek Messages. For the new Web Search API\'s features and pricing, see the ',
    'When off, restore this product\'s default search and page fetching. For the new Web Search API\'s features and pricing, see the ')
  replace('默认关闭，搜索通过 DeepSeek Messages 完成。新版 Web 搜索 API 功能与计费详见',
    '关闭时恢复产品默认的搜索与网页读取方式。新版 Web 搜索 API 功能与计费详见')
  replace('未配置密钥；仅使用 DeepSeek 账号模型的对话可以通过默认接口地址搜索。',
    '使用 DeepSeek 接口需要配置 API Key；默认搜索按产品设置运行。')
  replace('No key is configured; only conversations using a DeepSeek Account model can search, through the default endpoint.',
    'DeepSeek APIs require an API key; default search follows this product\'s settings.')
  return source
}
