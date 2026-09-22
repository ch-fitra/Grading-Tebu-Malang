# Electron desktop client

Electron displays the exact React UI used by `apps/web`, including the current login, dashboard, history, cameras, models, settings, theme, and Users & Roles screens. The desktop app does not run a second backend, AI service, or database. It connects to the same Fastify API as web and future Flutter clients.

## Development on Windows

Start PostgreSQL and the shared API as described in the root README. AI service is optional for UI development. In a separate terminal, run:

```powershell
npm run dev:desktop
```

This command builds `apps/web`, compiles Electron, and opens the desktop window using the local built renderer. It does not require the Vite server. Re-run the command after changing React code; browser hot reload remains available through `npm run dev:web`.

By default, desktop connects to `http://127.0.0.1:4110`. To connect to a central API, set the runtime address before starting Electron:

```powershell
$env:SUGARCANE_API_URL = "https://api.example.com"
npm run dev:desktop
```

Electron derives the WebSocket URL from that address (`https` becomes `wss`). The address is passed through a context isolated preload; the React UI does not gain Node.js access. The backend must be reachable from the desktop machine.

## Windows package

```powershell
npm run package -w @sugarcane/desktop -- --win
```

The package includes the built React files under `resources/renderer`; an installed app does not require Vite or a local web server. Set `SUGARCANE_API_URL` in the environment used to launch the installed app to select a remote API. The fallback is the local API on port 4110. Database credentials and AI configuration belong to the shared backend deployment, not to Electron.

The current Windows build is unsigned for local testing. Before public distribution, configure a Windows signing certificate and executable metadata in `apps/desktop/package.json`.

## Troubleshooting

- A connection message on login means the API cannot be reached; verify `/health` at the configured address.
- If the window cannot find its UI files, rebuild the web app with `npm run build -w @sugarcane/web`.
- If AI is offline, the status shown in desktop is the same status returned by the shared API to the web client.
