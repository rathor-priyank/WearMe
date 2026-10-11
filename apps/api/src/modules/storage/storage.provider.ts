/**
 * StorageProvider — abstract interface for all storage backends.
 *
 * V1: LocalStorageProvider (local disk)
 * V2: S3Provider, R2Provider, GCSProvider
 *
 * The application never calls cloud SDK methods directly — always through this interface.
 * Switching providers requires only a change in STORAGE_PROVIDER env var.
 */
export abstract class StorageProvider {
  /**
   * Upload a file to the given storage key.
   * @param key - Path within the storage bucket, e.g. "jobs/abc123/person.jpg"
   * @param buffer - File content as Buffer
   * @param mimeType - MIME type, e.g. "image/jpeg"
   */
  abstract upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;

  /**
   * Download a file and return it as a Buffer.
   */
  abstract download(key: string): Promise<Buffer>;

  /**
   * Generate a URL for accessing the file.
   * For local: a server URL. For cloud: a pre-signed URL.
   * @param expiresInSeconds - How long the URL should be valid (ignored for local)
   */
  abstract getUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Delete a file. Should not throw if file does not exist.
   */
  abstract delete(key: string): Promise<void>;

  /**
   * Check whether a file exists at the given key.
   */
  abstract exists(key: string): Promise<boolean>;

  /**
   * Health check — verifies storage backend is reachable.
   */
  abstract healthCheck(): Promise<boolean>;
}

