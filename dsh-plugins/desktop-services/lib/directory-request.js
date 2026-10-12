export async function pickDesktopDirectory(bridge, signal) {
  const response = await fetch(bridge.baseURL + '/v1/desktop/pick-directory', {
    method: 'POST', headers: { authorization: 'Bearer ' + bridge.token, 'content-type': 'application/json' },
    body: '{}', signal,
  })
  if (!response.ok) throw new Error('无法打开目录选择窗口，请重试。')
  const result = await response.json()
  if (result.path !== null && (typeof result.path !== 'string' || !result.path)) throw new Error('Invalid desktop directory selection')
  return result.path
}
