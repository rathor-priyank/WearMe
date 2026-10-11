# WearMe API Documentation (V1 / Phase 2)

Base URL: `http://localhost:3001/api/v1`  
Interactive Swagger UI: `http://localhost:3001/api/docs`

## Endpoints

### `POST /try-on/upload`
Uploads a person photo and an upper-body garment image (`multipart/form-data`), validates file signatures and dimensions, and creates a `PENDING` job.

- **Fields**:
  - `personImage` (`File`, required): `image/jpeg`, `image/png`, or `image/webp` (max 10 MB, verified via magic bytes + Sharp decoding, `64x64` to `4096x4096` px)
  - `garmentImage` (`File`, required): `image/jpeg`, `image/png`, or `image/webp` (max 10 MB, verified via magic bytes + Sharp decoding, `64x64` to `4096x4096` px)
  - `category` (`string`, required): `TOP` | `SHIRT` | `TSHIRT` | `JACKET`
- **Response `201`**:
  ```json
  {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "PENDING",
    "createdAt": "2026-10-12T00:00:00.000Z"
  }
  ```
- **Error `400`**: Missing file, unsupported MIME type, magic-byte mismatch, corrupt image data, or image dimensions outside `64x64`..`4096x4096`.

### `POST /try-on/:jobId/process`
Triggers VTON inference via `apps/ai` (`mock` or `fashn-api`).

- **Response `200`**:
  ```json
  {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "COMPLETED",
    "resultUrl": "http://localhost:3001/api/v1/files/jobs/550e8400-e29b-41d4-a716-446655440000/result.jpg"
  }
  ```
- **Error `500`**: Marks the job as `FAILED`, persists the user-safe error reason in `errorMessage` (e.g., missing `AI_API_KEY`, `PoseError`, rate limit, or timeout), and returns the error message. Never silently falls back to `mock` when `AI_PROVIDER=fashn-api`.

### `GET /try-on/:jobId/status`
Returns current job status, provider identifier (`mock` or `fashn-api`), error message (if failed), and resolved image URLs.

- **Response `200`**:
  ```json
  {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "COMPLETED",
    "category": "TSHIRT",
    "personImageUrl": "http://localhost:3001/api/v1/files/jobs/550e8400-e29b-41d4-a716-446655440000/person.jpg",
    "garmentImageUrl": "http://localhost:3001/api/v1/files/jobs/550e8400-e29b-41d4-a716-446655440000/garment.jpg",
    "resultUrl": "http://localhost:3001/api/v1/files/jobs/550e8400-e29b-41d4-a716-446655440000/result.jpg",
    "aiProvider": "fashn-api",
    "createdAt": "2026-10-12T00:00:00.000Z",
    "completedAt": "2026-10-12T00:00:11.000Z"
  }
  ```

### `DELETE /try-on/:jobId`
Immediately deletes all stored images (`person`, `garment`, `result`) from storage and removes the database job record.

- **Response `204`**: No Content.

### `GET /health`
Returns health status for PostgreSQL database, storage provider, and AI service.
