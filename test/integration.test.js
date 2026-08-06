import test from 'node:test'
import assert from 'node:assert'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function startServer(state) {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost')
      const send = (status, json) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(json))
      }
      const p = url.pathname

      if (req.headers.authorization === 'Bearer expired-token' && state.authErrorsLeft > 0) {
        state.authErrorsLeft--
        return send(401, { error: { message: 'Invalid Credentials' } })
      }

      if (p === '/device/code' && req.method === 'POST') {
        return send(200, {
          device_code: 'dev1',
          user_code: 'ABCD-EFGH',
          verification_url: 'https://example.invalid/device',
          interval: 0.05,
          expires_in: 600,
        })
      }

      if (p === '/token' && req.method === 'POST') {
        const params = new URLSearchParams(body)
        if (params.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
          state.devicePolls++
          if (state.devicePolls < 3) return send(400, { error: 'authorization_pending' })
          return send(200, { access_token: 'acc-device', refresh_token: 'ref1', expires_in: 3600 })
        }
        if (params.get('grant_type') === 'refresh_token') {
          return send(200, { access_token: 'acc-refreshed', expires_in: 3600 })
        }
        return send(400, { error: 'invalid_grant' })
      }

      if (p === '/tasks/v1/users/@me/lists') {
        return send(200, { items: [{ id: 'list1', title: 'Personal' }] })
      }
      if (p.startsWith('/tasks/v1/lists/') && p.endsWith('/tasks')) {
        return send(200, { items: state.tasks })
      }

      if (p === '/calendar/v3/calendars/task2wrist') {
        return state.calendar ? send(200, state.calendar) : send(404, { error: { message: 'Not Found' } })
      }
      if (p === '/calendar/v3/calendars' && req.method === 'POST') {
        state.calendar = JSON.parse(body)
        return send(200, state.calendar)
      }
      if (p === '/calendar/v3/calendars/task2wrist/events' && req.method === 'GET') {
        return send(200, { items: state.events })
      }
      if (p === '/calendar/v3/calendars/task2wrist/events' && req.method === 'POST') {
        const ev = JSON.parse(body)
        ev.id = 'evt' + (state.events.length + 1)
        state.events.push(ev)
        return send(200, ev)
      }
      const m = p.match(/^\/calendar\/v3\/calendars\/task2wrist\/events\/(.+)$/)
      if (m) {
        const id = decodeURIComponent(m[1])
        if (req.method === 'DELETE') {
          state.events = state.events.filter((e) => e.id !== id)
          return send(204, {})
        }
        if (req.method === 'PUT') {
          const ev = JSON.parse(body)
          ev.id = id
          const i = state.events.findIndex((e) => e.id === id)
          if (i >= 0) state.events[i] = ev
          return send(200, ev)
        }
      }

      if (p === '/oauth2/v3/userinfo') return send(200, { email: 'test@example.com' })
      return send(404, { error: { message: 'not found ' + req.method + ' ' + p } })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

function freshState() {
  return {
    devicePolls: 0,
    authErrorsLeft: 0,
    tasks: [
      { id: 't1', title: 'Buy milk', due: '2026-08-06T00:00:00.000Z', status: 'needsAction' },
      { id: 't2', title: 'Dentist', due: '2026-08-07T15:00:00.000Z', status: 'needsAction' },
    ],
    events: [],
    calendar: null,
  }
}

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.js'), ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => resolve({ code, out, err }))
    child.on('error', reject)
  })
}

async function makeEnv(port) {
  const home = mkdtempSync(path.join(os.tmpdir(), 't2w-int-'))
  writeFileSync(
    path.join(home, 'client_secret.json'),
    JSON.stringify({ installed: { client_id: 'test.apps.googleusercontent.com' } }),
  )
  const env = {
    ...process.env,
    TASK2WRIST_HOME: home,
    TASK2WRIST_OAUTH_BASE: `http://127.0.0.1:${port}`,
    TASK2WRIST_API_BASE: `http://127.0.0.1:${port}`,
  }
  return { home, env }
}

test('end-to-end CLI: login, sync, idempotency, list, status, refresh', async () => {
  const state = freshState()
  const { server, port } = await startServer(state)
  const { home, env } = await makeEnv(port)

  try {
    const tokenFile = path.join(home, 'token.json')

    const login = await runCli(['login'], env)
    assert.equal(login.code, 0, login.err)
    assert.match(login.out, /authorized/)
    assert.ok(existsSync(tokenFile))

    const sync1 = await runCli(['sync'], env)
    assert.equal(sync1.code, 0, sync1.err)
    assert.match(sync1.out, /created: 2/)
    assert.equal(state.events.length, 2)

    const sync2 = await runCli(['sync'], env)
    assert.equal(sync2.code, 0, sync2.err)
    assert.match(sync2.out, /created: 0, updated: 0, deleted: 0/)

    const list = await runCli(['list'], env)
    assert.equal(list.code, 0, list.err)
    assert.match(list.out, /Buy milk/)

    const status = await runCli(['status'], env)
    assert.equal(status.code, 0, status.err)
    assert.match(status.out, /test@example\.com/)

    state.tasks[0].status = 'completed'
    const sync3 = await runCli(['sync'], env)
    assert.equal(sync3.code, 0, sync3.err)
    assert.match(sync3.out, /deleted: 1/)
    assert.equal(state.events.length, 1)

    writeFileSync(tokenFile, JSON.stringify({ access_token: 'expired-token', refresh_token: 'ref1', expiry: Date.now() - 1000 }))
    state.authErrorsLeft = 1
    const sync4 = await runCli(['sync'], env)
    assert.equal(sync4.code, 0, sync4.err)
    assert.ok(readFileSync(tokenFile, 'utf8').includes('acc-refreshed'))
  } finally {
    server.close()
  }
})
