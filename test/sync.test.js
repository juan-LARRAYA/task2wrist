import test from 'node:test'
import assert from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TASK2WRIST_HOME = mkdtempSync(path.join(os.tmpdir(), 'task2wrist-test-'))
const home = process.env.TASK2WRIST_HOME

writeFileSync(path.join(home, 'client_secret.json'), JSON.stringify({ installed: { client_id: 'test.apps.googleusercontent.com' } }))
writeFileSync(path.join(home, 'token.json'), JSON.stringify({ access_token: 't', refresh_token: 'r', expiry: Date.now() + 3600e3 }))

function makeFetch(state) {
  return async (url, opts = {}) => {
    const u = new URL(url)
    const method = opts.method || 'GET'
    const p = u.pathname
    const body = opts.body ? JSON.parse(opts.body) : undefined
    const res = (status, json) => ({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(json),
      text: () => Promise.resolve(JSON.stringify(json)),
    })
    if (p === '/tasks/v1/users/@me/lists') return res(200, { items: state.lists })
    if (p.startsWith('/tasks/v1/lists/') && p.endsWith('/tasks')) return res(200, { items: state.tasks })
    if (p === '/calendar/v3/calendars/task2wrist') {
      if (state.calendar) return res(200, state.calendar)
      return res(404, { error: { message: 'Not Found' } })
    }
    if (p === '/calendar/v3/calendars' && method === 'POST') {
      state.calendar = body
      return res(200, state.calendar)
    }
    if (p === '/calendar/v3/calendars/task2wrist/events' && method === 'GET') {
      return res(200, { items: [...state.events] })
    }
    if (p === '/calendar/v3/calendars/task2wrist/events' && method === 'POST') {
      body.id = 'evt' + (state.events.length + 1)
      state.events.push(body)
      return res(200, body)
    }
    const m = p.match(/^\/calendar\/v3\/calendars\/task2wrist\/events\/(.+)$/)
    if (m) {
      const id = decodeURIComponent(m[1])
      if (method === 'DELETE') {
        state.events = state.events.filter((e) => e.id !== id)
        return res(204, {})
      }
      if (method === 'PUT') {
        const idx = state.events.findIndex((e) => e.id === id)
        body.id = id
        if (idx >= 0) state.events[idx] = body
        return res(200, body)
      }
    }
    throw new Error('unhandled: ' + method + ' ' + p)
  }
}

function freshState() {
  return {
    lists: [{ id: 'list1', title: 'Personal' }],
    tasks: [
      { id: 't1', title: 'Buy milk', due: '2026-08-06T00:00:00.000Z', status: 'needsAction', notes: '2L' },
      { id: 't2', title: 'Dentist', due: '2026-08-07T15:00:00.000Z', status: 'needsAction' },
      { id: 't3', title: 'No date', status: 'needsAction' },
      { id: 't4', title: 'Done task', due: '2026-08-05T00:00:00.000Z', status: 'completed' },
    ],
    events: [],
    calendar: null,
  }
}

const { runSync } = await import('../src/sync.js')

test('first sync creates events and skips no-date/completed tasks', async () => {
  const state = freshState()
  globalThis.fetch = makeFetch(state)

  const r = await runSync()

  assert.equal(r.created, 2)
  assert.equal(state.events.length, 2)
  assert.equal(state.calendar.id, 'task2wrist')

  const milk = state.events.find((e) => e.summary === 'Buy milk')
  assert.equal(milk.start.date, '2026-08-06')
  assert.equal(milk.end.date, '2026-08-07')
  assert.ok(milk.description.includes('list:list1\ntask:t1'))

  const dentist = state.events.find((e) => e.summary === 'Dentist')
  assert.equal(dentist.start.dateTime, '2026-08-07T15:00:00.000Z')
  assert.equal(dentist.end.dateTime, '2026-08-07T15:30:00.000Z')
})

test('second sync is idempotent', async () => {
  const state = freshState()
  globalThis.fetch = makeFetch(state)
  await runSync()

  const r = await runSync()

  assert.deepEqual(r, { created: 0, updated: 0, deleted: 0, total: 2 })
})

test('editing a task updates its event', async () => {
  const state = freshState()
  globalThis.fetch = makeFetch(state)
  await runSync()

  state.tasks[0].title = 'Buy 2L of milk'
  const r = await runSync()

  assert.equal(r.updated, 1)
  assert.equal(state.events[0].summary, 'Buy 2L of milk')
})

test('completing a task removes its event', async () => {
  const state = freshState()
  globalThis.fetch = makeFetch(state)
  await runSync()

  state.tasks[1].status = 'completed'
  const r = await runSync()

  assert.equal(r.deleted, 1)
  assert.equal(state.events.length, 1)
})

test('deleting a task removes its event', async () => {
  const state = freshState()
  globalThis.fetch = makeFetch(state)
  await runSync()

  state.tasks = state.tasks.filter((t) => t.id !== 't1')
  const r = await runSync()

  assert.equal(r.deleted, 1)
  assert.equal(state.events.length, 1)
})

test('removing the due date removes the event', async () => {
  const state = freshState()
  globalThis.fetch = makeFetch(state)
  await runSync()

  delete state.tasks[0].due
  const r = await runSync()

  assert.equal(r.deleted, 1)
  assert.equal(state.events.length, 1)
})
