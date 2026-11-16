export function extractBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  return match?.[1] ?? null;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function findGatewayFridgeId(
  db: D1Database,
  tokenHash: string,
): Promise<string | null> {
  const { results } = await db
    .prepare(
      `SELECT fs.fridge_id
       FROM fridge_secrets fs
       INNER JOIN fridges f ON f.id = fs.fridge_id
       WHERE fs.gateway_token_hash = ?
       LIMIT 2`,
    )
    .bind(tokenHash)
    .all<{ fridge_id: string }>();

  return results.length === 1 ? (results[0]?.fridge_id ?? null) : null;
}
