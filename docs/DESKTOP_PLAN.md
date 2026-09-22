# Desktop implementation plan

## Findings

- The reference Electron app is a development orchestrator: it opens a Vite URL and starts separate API, web, and AI processes. Its package only includes `dist/main.js`, so the installed app has no React UI.
- The current web app already contains the reference dashboard, history, cameras, models, settings, login, theme, and inspection screens, plus the newer user and role screens. Reusing its renderer keeps web and desktop visually identical.
- The shared Fastify API is the system of record. Desktop needs a configurable API address at runtime, while the React renderer must retain its existing browser configuration.

## Execution

1. Build the React app with relative asset paths so Electron can load the same production files locally.
2. Replace the Electron development orchestrator with a desktop window that loads the built React UI, and expose only the API and WebSocket addresses through a context isolated preload.
3. Include the renderer in Electron packages and provide clear commands for development and packaged use.
4. Verify TypeScript and production builds, the renderer asset paths, API access, and Electron startup or packaging where this environment permits.

## Acceptance

- Desktop shows the same React screens, theme, and interactions as the web client.
- Desktop uses the same API and PostgreSQL data as web; it starts no second backend or database.
- A packaged desktop app has its UI files and does not depend on a Vite server.
- Configuration and failure behavior are documented; build and smoke checks pass.

## Verification completed (2026-09-17)

- `npm run build` and `npm run typecheck` passed for all workspaces.
- `npm audit` reported 0 vulnerabilities after updating the desktop packager.
- `npm run dev:desktop` opened the desktop window from the local React build.
- `npm run package -w @sugarcane/desktop -- --win` created a Windows installer and unpacked executable.
- A packaged-app smoke check confirmed the React screen, CSS, logo, local storage, runtime API address, API health, authenticated WebSocket connection, and navigation through Dashboard, History, Cameras, Models, Settings, and Users & Roles.
