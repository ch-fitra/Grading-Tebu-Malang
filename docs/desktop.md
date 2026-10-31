# Electron desktop client

Electron displays the same React UI used by `apps/web`. All shared frontend changes belong in `apps/web/src`; `apps/desktop` contains only the Electron window, preload, configuration, and launch scripts. Both clients connect to the same backend services.

## Development on Windows

Start PostgreSQL and the shared API as described in the root README. AI service is optional for UI development. In a separate terminal, run:

```powershell
npm run dev:desktop
```

This command compiles Electron and opens the shared Vite UI at `http://127.0.0.1:5176`. It reuses this project's Vite server when one is already running, or starts one automatically. Saving React or CSS changes updates browser and desktop together without rebuilding. Restart this command after changing Electron code in `apps/desktop/src`.

To run both clients, start `npm run dev:web` first, then `npm run dev:desktop` in another terminal. Closing desktop leaves a separately started web server running; a server started by desktop itself stops with desktop. The alias `npm run dev:dekstop` is also supported.

By default, desktop connects to `http://127.0.0.1:4111`. To connect to a central API, set the runtime address before starting Electron:

```powershell
$env:SUGARCANE_API_URL = "https://api.example.com"
npm run dev:desktop
```

Electron derives the WebSocket URL from that address (`https` becomes `wss`). The address is passed through a context isolated preload; the React UI does not gain Node.js access. The backend must be reachable from the desktop machine.

## Windows package

```powershell
npm run package -w @sugarcane/desktop -- --win
```

The package includes the built React files under `resources/renderer`. Electron starts its own loopback HTTP server on an available port to serve these files and proxy API, snapshots and WebSocket traffic to the configured backend. No separate Vite or web-server installation is needed. This keeps login cookies, media and root-relative images working in the installed app. Set `SUGARCANE_API_URL` in the environment used to launch the installed app to select a remote API. The fallback is the local API on port 4111. Database credentials and AI configuration belong to the shared backend deployment, not to Electron.

The current Windows build is unsigned for local testing. Before public distribution, configure a Windows signing certificate and executable metadata in `apps/desktop/package.json`.

## Troubleshooting

- A connection message on login means the API cannot be reached; verify `/health` at the configured address.
- If port 5176 belongs to another application or checkout, stop that process before starting desktop.
- For direct Electron startup without Vite, build the web app first with `npm run build -w @sugarcane/web`. Installed applications always use their bundled renderer.
- If AI is offline, the status shown in desktop is the same status returned by the shared API to the web client.
