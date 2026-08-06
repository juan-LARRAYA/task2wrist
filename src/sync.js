import { api } from './api.js'
import { Token } from './auth.js'
import { CALENDAR_ID, MARKER } from './config.js'

export async function ensureCalendar(token) {
  try {
    return await api(token, '/calendar/v3/calendars/' + CALENDAR_ID)
  } catch (err) {
    if (err.status !== 404) throw err
  }
  return api(token, '/calendar/v3/calendars', {
    method: 'POST',
    body: {
      id: CALENDAR_ID,
      summary: 'Task2Wrist - Google Tasks',
      description: 'Synced automatically from Google Tasks by task2wrist.',
    },
  })
}

function isDateOnly(ts) {
  return /^\d{4}-\d{2}-\d{2}T00:00:00(\.\d+)?Z$/.test(ts)
}

function plusDays(date, n) {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function buildEvent(task, listId) {
  const marker = `\n\n---\n${MARKER}:v1\nlist:${listId}\ntask:${task.id}`
  const description = task.notes ? task.notes + marker : marker

  if (task.due && isDateOnly(task.due)) {
    const start = task.due.slice(0, 10)
    return {
      summary: task.title,
      description,
      start: { date: start },
      end: { date: plusDays(start, 1) },
      transparency: 'transparent',
    }
  }

  const startMs = Date.parse(task.due)
  if (!Number.isFinite(startMs)) return null
  return {
    summary: task.title,
    description,
    start: { dateTime: task.due },
    end: { dateTime: new Date(startMs + 30 * 60000).toISOString() },
  }
}

function eventChanged(existing, want) {
  if (existing.summary !== want.summary) return true
  if ((existing.description || '') !== want.description) return true
  if (existing.start.date) {
    return existing.start.date !== want.start.date || existing.end.date !== want.end.date
  }
  return Date.parse(existing.start.dateTime) !== Date.parse(want.start.dateTime)
}

async function fetchAllTasks(token, listId) {
  const tasks = []
  let pageToken
  do {
    const res = await api(
      token,
      `/tasks/v1/lists/${listId}/tasks?showCompleted=true&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
    )
    tasks.push(...(res.items || []))
    pageToken = res.nextPageToken
  } while (pageToken)
  return tasks
}

async function fetchMarkerEvents(token) {
  const events = []
  let pageToken
  do {
    const res = await api(
      token,
      `/calendar/v3/calendars/${CALENDAR_ID}/events?maxResults=2500${pageToken ? `&pageToken=${pageToken}` : ''}`,
    )
    for (const ev of res.items || []) {
      if ((ev.description || '').includes(MARKER)) events.push(ev)
    }
    pageToken = res.nextPageToken
  } while (pageToken)
  return events
}

function extractKey(ev) {
  const m = (ev.description || '').match(/list:([A-Za-z0-9_-]+)\ntask:([A-Za-z0-9_-]+)/)
  if (!m) return null
  return `${m[1]}/${m[2]}`
}

export async function runSync() {
  const token = Token.load()

  await ensureCalendar(token)

  const listsRes = await api(token, '/tasks/v1/users/@me/lists?maxResults=100')
  const lists = listsRes.items || []
  const seen = new Set()

  const byKey = new Map()
  for (const ev of await fetchMarkerEvents(token)) {
    const key = extractKey(ev)
    if (key) byKey.set(key, ev)
  }

  let created = 0
  let updated = 0
  let deleted = 0

  for (const list of lists) {
    const tasks = await fetchAllTasks(token, list.id)
    for (const task of tasks) {
      if (task.status === 'completed') continue
      if (!task.due) continue
      const want = buildEvent(task, list.id)
      if (!want) continue
      const key = `${list.id}/${task.id}`
      seen.add(key)
      const ev = byKey.get(key)
      if (!ev) {
        await api(token, `/calendar/v3/calendars/${CALENDAR_ID}/events`, {
          method: 'POST',
          body: want,
        })
        created++
      } else if (eventChanged(ev, want)) {
        await api(token, `/calendar/v3/calendars/${CALENDAR_ID}/events/${ev.id}`, {
          method: 'PUT',
          body: { ...want, id: ev.id },
        })
        updated++
      }
    }
  }

  for (const [key, ev] of byKey) {
    if (seen.has(key)) continue
    await api(token, `/calendar/v3/calendars/${CALENDAR_ID}/events/${ev.id}`, {
      method: 'DELETE',
    })
    deleted++
  }

  return { created, updated, deleted, total: byKey.size - deleted + created }
}
