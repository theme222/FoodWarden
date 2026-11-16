export const MAX_MANUAL_JPEG_BYTES = 1_500_000;
export const MAX_CHECKIN_JPEG_BYTES = 5_000_000;

export function isValidJpegBytes(
  bytes: Uint8Array,
  maxBytes: number = MAX_MANUAL_JPEG_BYTES,
): boolean {
  if (bytes.byteLength < 5 || bytes.byteLength > maxBytes) return false;
  return (
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.byteLength - 2] === 0xff &&
    bytes[bytes.byteLength - 1] === 0xd9
  );
}

export function inventoryPhotoKey(
  value: unknown,
  fridgeId: string,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/^\/storage\//, "");
  const prefix = `food_crops/${fridgeId}/`;
  if (!normalized.startsWith(prefix)) return null;
  const filename = normalized.slice(prefix.length);
  if (!/^[a-z0-9_.-]+\.jpe?g$/i.test(filename) || filename.includes("..")) {
    return null;
  }
  return normalized;
}

export function buildFoodPhotoKey(
  fridgeId: string,
  itemId: string,
  sha256Hex: string,
): string {
  return `food_crops/${fridgeId}/${itemId}-${sha256Hex}.jpg`;
}

export function toStoragePath(r2Key: string): string {
  return `/storage/${r2Key}`;
}

export async function putImmutablePhoto(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array,
): Promise<void> {
  const result = await bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: {
      contentType: "image/jpeg",
      cacheControl: "private, no-store",
    },
  });
  // R2 returns null when an `onlyIf` precondition fails (object with this content-addressed key already exists).
  void result;
}

export async function getPrivatePhoto(
  bucket: R2Bucket,
  key: string,
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deletePrivatePhoto(
  bucket: R2Bucket,
  key: string,
): Promise<void> {
  await bucket.delete(key);
}
// Atomically prevent new references before deleting the last unreferenced R2 object.
export async function retireUnreferencedPhoto(
  db: D1Database,
  photos: R2Bucket,
  key: string,
): Promise<boolean> {
  const path = toStoragePath(key);
  const claim = await db
    .prepare(
      `INSERT INTO photo_gc_claims (key)
    SELECT ? WHERE NOT EXISTS (SELECT 1 FROM inventory WHERE image_storage_path = ? OR image_storage_path = ?)
    ON CONFLICT(key) DO UPDATE SET key = excluded.key RETURNING key`,
    )
    .bind(path, path, key)
    .first();
  if (!claim) return false;
  await deletePrivatePhoto(photos, key);
  return true;
}
