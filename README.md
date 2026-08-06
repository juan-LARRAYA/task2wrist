# task2wrist ⌚

**Google Tasks on your wrist, on *any* watch.**

The Redmi Watch 6 (and most budget watches) don't support Google Tasks. They *do* sync Google Calendar. `task2wrist` bridges the gap: it turns your Google Tasks into calendar events in a dedicated calendar, so they show up as reminders on your wrist — no Wear OS, no Google Play, no proprietary app required.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)

---

## Compatible with

| Watch | How it gets the calendar |
|---|---|
| **Redmi Watch 6 / 5 / Active** | Mi Fitness / Xiaomi calendar sync |
| Xiaomi Watch S-series | Mi Fitness calendar sync |
| Xiaomi Watch 5 (Wear OS) | Google Calendar app |
| Garmin | Garmin Connect calendar sync |
| Huawei GT series | Huawei Health calendar sync |
| Amazfit | Zepp calendar sync |
| Samsung Galaxy Watch | Google Calendar app |
| Any Wear OS watch | Google Calendar app |

If your watch mirrors phone notifications or a phone calendar, it works.

---

## How it works

```
Google Tasks ──► task2wrist (cron) ──► Google Calendar ("Task2Wrist") ──► watch reminders
   ▲                                                    │
   └────────────────────────────────────────────────────┘  idempotent, 2-way safe
```

- Reads all your task lists, takes tasks **with a due date**.
- Creates one calendar event per task in a calendar called **Task2Wrist - Google Tasks**.
- **Idempotent:** run it as many times as you want — tasks are only created once, updated when they change, and removed when you complete or delete them.
- Date-only tasks become all-day events; timed tasks become 30-minute events.
- Runs on the phone via `crond` every 15 minutes (configurable).

---

## Manual setup (5 minutes)

`task2wrist` uses OAuth 2.0 with **device flow** — you authorize on the phone browser without localhost or a server.

1. **Create an OAuth client** in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   - Create a project (or use an existing one).
   - Go to **APIs & Services → Enabled APIs** and enable:
     - `Google Tasks API`
     - `Google Calendar API`
   - Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **TVs and Limited Input devices**.
   - Download the JSON and save it as:
     - `$HOME/.config/task2wrist/client_secret.json`
     - (override with `TASK2WRIST_HOME=/custom/path`)

2. **Authorize:**
   ```sh
   node src/cli.js login
   ```
   Open the URL shown, enter the code, done. Credentials are stored locally at `$HOME/.config/task2wrist/token.json`.

3. **First sync:**
   ```sh
   node src/cli.js sync
   ```

4. **Automate it** (recommended):
   ```sh
   sudo ./bin/install-cron.sh          # every 15 minutes
   TASK2WRIST_INTERVAL_MIN=5 sudo ./bin/install-cron.sh   # every 5 minutes
   ```

5. **On the phone / watch:**
   - Make sure your Google account calendar sync is ON (Settings → Accounts → Google).
   - In the Xiaomi **Mi Fitness** app, enable calendar/reminder sync so the watch mirrors the calendar.
   - Open the calendar on your watch — your tasks are there.

---

## Usage

```sh
node src/cli.js login       # authorize with Google
node src/cli.js sync        # push tasks -> calendar
node src/cli.js list        # preview which tasks will sync
node src/cli.js status      # account + calendar info
node src/cli.js logout      # remove stored credentials
```

---

## Troubleshooting

- **`Missing credentials file`** → you haven't saved `client_secret.json`. Follow the setup above.
- **`Failed to refresh token`** → re-run `node src/cli.js login`.
- **Tasks not showing on the watch** → confirm the calendar sync is enabled in your watch's companion app, and that tasks have a due date (tasks without a due date are intentionally skipped).
- **Changed a task but the watch shows the old one** → run `node src/cli.js sync` and force a refresh on the watch app.

---

## Testing

Zero-dependency tests using Node's built-in runner:

```sh
npm test
```

- `test/sync.test.js` — sync logic against a mocked Google API (idempotency, updates, completion/deletion, all-day vs timed events).
- `test/integration.test.js` — spawns the **real CLI processes** (`login`, `sync`, `list`, `status`) against a local server implementing Google's OAuth device flow, Tasks, and Calendar protocol, including token refresh.

The integration test runs on a local mock so it never touches your real Google data. To point the app at a different endpoint (e.g. a mock or proxy) set `TASK2WRIST_API_BASE` and `TASK2WRIST_OAUTH_BASE`; they default to Google's endpoints.

---

## Privacy

Your credentials and tokens stay on your device in `~/.config/task2wrist/` and are never sent anywhere except Google's own APIs. No servers, no tracking, no analytics — this runs entirely on your machine.

---

## License

[MIT](LICENSE)
