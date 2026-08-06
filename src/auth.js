import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CREDS_FILE, TOKEN_FILE, SCOPES } from './config.js'

function ensureDir(file) {
  mkdirSync(path.dirname(file), { recursive: true })
}

export function readClientId() {
  const raw = JSON.parse(readFileSync(CREDS_FILE, 'utf8'))
  return raw.installed?.client_id || raw.web?.client_id
}

export function hasToken() {
  return existsSync(TOKEN_FILE)
}

export class Token {
  constructor(data = null) {
    this.data = data
  }

  static load() {
    if (!existsSync(TOKEN_FILE)) {
      throw new Error('No session found. Run: node src/cli.js login')
    }
    return new Token(JSON.parse(readFileSync(TOKEN_FILE, 'utf8')))
  }

  get clientId() {
    return readClientId()
  }

  get value() {
    return this.data.access_token
  }

  get isExpired() {
    return Date.now() >= (this.data.expiry || 0) - 60000
  }

  save() {
    ensureDir(TOKEN_FILE)
    writeFileSync(TOKEN_FILE, JSON.stringify(this.data, null, 2))
  }

  async refresh() {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        refresh_token: this.data.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) throw new Error('Failed to refresh token: ' + (await res.text()))
    const data = await res.json()
    this.data.access_token = data.access_token
    this.data.expiry = Date.now() + (data.expires_in || 3600) * 1000
    this.save()
  }
}

async function deviceAuthorization(clientId) {
  const res = await fetch('https://oauth2.googleapis.com/device/code', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPES }),
  })
  if (!res.ok) throw new Error('device/code failed: ' + (await res.text()))
  return res.json()
}

async function pollForToken(clientId, deviceCode, interval) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  for (;;) {
    await sleep(interval * 1000)
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const data = await res.json()
    if (data.access_token) {
      data.expiry = Date.now() + (data.expires_in || 3600) * 1000
      return data
    }
    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') {
      interval += 5
      continue
    }
    throw new Error('Authorization failed: ' + JSON.stringify(data))
  }
}

export async function login() {
  const clientId = readClientId()
  const device = await deviceAuthorization(clientId)
  console.log('')
  console.log('  1. Open this URL in the browser on your phone:')
  console.log('     ' + device.verification_url)
  console.log('')
  console.log('  2. Enter this code:')
  console.log('     ' + device.user_code)
  console.log('')
  process.stdout.write('Waiting for authorization')
  const data = await pollForToken(clientId, device.device_code, device.interval)
  const token = new Token(data)
  token.save()
  console.log(' -> authorized.')
}
