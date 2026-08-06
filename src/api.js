import { API_BASE } from './config.js'

export async function api(token, path, opts = {}) {
  const method = opts.method || 'GET'
  let headers = { authorization: 'Bearer ' + token.value }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'

  let res = await fetch(API_BASE + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

  if (res.status === 401) {
    await token.refresh()
    headers.authorization = 'Bearer ' + token.value
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  }

  if (res.status === 204 || res.status === 202) return null

  if (!res.ok) {
    const text = await res.text()
    const err = new Error(`${method} ${path} -> ${res.status}: ${text}`)
    err.status = res.status
    throw err
  }

  return res.json()
}
