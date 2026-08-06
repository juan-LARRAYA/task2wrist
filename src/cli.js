#!/usr/bin/env node
import { existsSync, unlinkSync } from 'node:fs'
import { login, hasToken, Token } from './auth.js'
import { runSync, ensureCalendar } from './sync.js'
import { api } from './api.js'
import { CREDS_FILE, TOKEN_FILE } from './config.js'

const [, , cmd] = process.argv

function help() {
  console.log(`
task2wrist - Google Tasks on your wrist

Usage:
  node src/cli.js login       authorize with Google (device flow)
  node src/cli.js sync        one-shot sync Tasks -> Calendar
  node src/cli.js sync:quiet  one-shot sync with no output (for cron)
  node src/cli.js list        list your tasks that have a due date
  node src/cli.js status      show account and calendar status
  node src/cli.js logout      remove stored credentials
`)
}

async function doSync(quiet) {
  if (!hasToken()) {
    console.error('No session found. Run: node src/cli.js login')
    process.exit(1)
  }
  const r = await runSync()
  if (!quiet) console.log(`Sync done - created: ${r.created}, updated: ${r.updated}, deleted: ${r.deleted}. Total events: ${r.total}`)
}

async function listTasks() {
  if (!hasToken()) {
    console.error('No session found. Run: node src/cli.js login')
    process.exit(1)
  }
  const token = Token.load()
  const listsRes = await api(token, '/tasks/v1/users/@me/lists?maxResults=100')
  for (const list of listsRes.items || []) {
    const res = await api(token, `/tasks/v1/lists/${list.id}/tasks?showCompleted=false&maxResults=100`)
    for (const t of res.items || []) {
      if (t.due) console.log(`${t.due}  [${list.title}]  ${t.title}`)
    }
  }
}

async function status() {
  if (!hasToken()) {
    console.error('No session found. Run: node src/cli.js login')
    process.exit(1)
  }
  const token = Token.load()
  const me = await api(token, '/oauth2/v3/userinfo')
  const cal = await ensureCalendar(token)
  const r = await runSync()
  console.log(`Account:   ${me.email}`)
  console.log(`Calendar:  ${cal.summary} (${cal.id})`)
  console.log(`Events:    ${r.total}`)
}

async function logout() {
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE)
  console.log('Credentials removed.')
}

if (!existsSync(CREDS_FILE)) {
  console.error(`Missing credentials file: ${CREDS_FILE}`)
  console.error('Follow the manual setup in the README to create an OAuth client and download client_secret.json.')
  process.exit(1)
}

switch (cmd) {
  case 'login':
    await login()
    break
  case 'sync':
    await doSync(false)
    break
  case 'sync:quiet':
    await doSync(true)
    break
  case 'list':
    await listTasks()
    break
  case 'status':
    await status()
    break
  case 'logout':
    await logout()
    break
  default:
    help()
    break
}
