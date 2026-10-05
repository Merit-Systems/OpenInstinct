import { createHmac, timingSafeEqual } from "node:crypto";

export function blooioSignatureHeader(
  secret: string,
  rawBody: string,
  timestampSeconds = Math.floor(Date.now() / 1000)
) {
  const signature = createHmac("sha256", secret)
    .update(`${String(timestampSeconds)}.${rawBody}`)
    .digest("hex");
  return `t=${String(timestampSeconds)},v1=${signature}`;
}

export function verifyBlooioSignature(
  secret: string,
  rawBody: string,
  header: string | null,
  toleranceSeconds = 300
) {
  if (!header) return false;
  const parts = new Map(
    header.split(",").flatMap((part) => {
      const index = part.indexOf("=");
      if (index <= 0) return [];
      return [
        [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const,
      ];
    })
  );
  const timestamp = Number(parts.get("t"));
  const provided = parts.get("v1")?.toLowerCase();
  if (
    !Number.isFinite(timestamp) ||
    !provided ||
    !/^[a-f0-9]+$/.test(provided)
  ) {
    return false;
  }
  if (
    toleranceSeconds > 0 &&
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds
  ) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${String(timestamp)}.${rawBody}`)
    .digest("hex");
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}
