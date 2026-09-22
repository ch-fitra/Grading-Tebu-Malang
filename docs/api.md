# API

## Backend

```plaintext
GET    /health
GET    /ws
POST   /api/auth/login
GET    /api/auth/me
GET    /api/system/status
GET    /api/cameras
POST   /api/cameras
PUT    /api/cameras/:id
DELETE /api/cameras/:id
GET    /api/inference/latest
GET    /api/inference/history
GET    /api/models
POST   /api/models/upload
POST   /api/models/activate
GET    /api/truck-inspections
POST   /api/truck-inspections
PATCH  /api/truck-inspections/:id/complete
DELETE /api/truck-inspections/:id
GET    /api/users
POST   /api/users
PATCH  /api/users/:id
GET    /api/roles
POST   /api/roles
PUT    /api/roles/:id
DELETE /api/roles/:id
```

All `/api/*` routes except login require `Authorization: Bearer <token>` and server-side permission checks. `POST /api/models/upload` accepts multipart fields `name`, `version`, and one `.onnx` file (up to 200 MB) saved under `models/archive`. Truck endpoints use the same PostgreSQL records for web, Electron, and Flutter; `GET` returns capture IDs, average impurity/confidence, count, and derived decision. `POST` requires `truckCode` and a valid camera ID in `line`.

## AI Service

```plaintext
GET  /health
POST /infer
```

Infer request:

```json
{
  "image_path": "storage/snapshots/frame.jpg",
  "camera_id": 1
}
```

Infer response:

```json
{
  "timestamp": "2026-05-28T12:00:00",
  "camera_id": 1,
  "classes": {
    "daun": 8.1,
    "pucuk": 3.2,
    "sampah": 1.1
  },
  "confidence": 0.91
}
```
