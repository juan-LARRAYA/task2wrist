import { homedir } from 'node:os'
import path from 'node:path'

export const CONFIG_DIR = process.env.TASK2WRIST_HOME || path.join(homedir(), '.config', 'task2wrist')
export const CREDS_FILE = path.join(CONFIG_DIR, 'client_secret.json')
export const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json')
export const SCOPES = 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar'
export const CALENDAR_ID = 'task2wrist'
export const MARKER = 'task2wrist'
