# Flutter mobile implementation plan

## Audit (before implementation)

- `apps/mobile` contains only a placeholder README. There is no Flutter project or SDK in PATH.
- The React web client and Electron renderer share the Fastify API, PostgreSQL data, and role permissions. Mobile must use these same endpoints and must not connect to PostgreSQL or Python AI directly.
- The API exposed authentication, system status, cameras, models, inference history, users, and roles. Truck inspections were browser-local and model upload only recorded a filename; both gaps had to be fixed before mobile could honestly claim shared, real data.

## Execution

1. Scaffold a Flutter Android/iOS project and organize `lib` by core services and features.
2. Implement a branded adaptive mobile UI with matching green light/dark themes, real API data, session persistence, permission-aware navigation, loading/empty/error states, and realtime refresh.
3. Implement available operations: login, dashboard and history, camera CRUD, model list/activation/upload, settings, and developer/admin user and role management.
4. Add PostgreSQL-backed truck-inspection routes and make the web and mobile clients use them. Keep old browser-local records visible as legacy data rather than deleting them.
5. Add a server URL setting for emulator, physical device, or central deployment; document backend network requirements.
6. Run formatting, static analysis, tests, and an Android build where local toolchains allow; record any remaining platform limits explicitly.

## Result and verification

- Flutter 3.47.4 project scaffolded for Android/iOS; login, dashboard, history, trucks, cameras, models, access management, and settings implemented.
- Mobile uses REST and WebSocket with token from secure storage; no local dummy operational records.
- New truck sessions are in PostgreSQL and visible to web/desktop/mobile. Existing old browser-local sessions remain visible in that browser only and are not silently deleted; they require explicit migration if cross-device history is needed.
- Migration `004_active_truck_line.sql` enforces one active inspection per camera/line; different lines may run concurrently.
- ONNX uploads now save a real file under `models/archive` before metadata is inserted. Activation still records the selected model in PostgreSQL; AI service model reload/inference behavior was not changed in this mobile task.
- `flutter analyze`, `flutter test` (4 tests), Android debug/release APK builds, API/web/desktop/contracts TypeScript checks and production builds passed. Release APK is still signed with Flutter's debug key and is **not** a publishable production artifact. A separately started API was exercised against PostgreSQL for login, truck list, models, and roles; admin responses were checked to exclude developer users/roles. No Android emulator or iOS/macOS device was available for on-device visual testing; iOS build requires macOS/Xcode.
