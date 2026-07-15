import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validate the `intuit-signature` header on a QuickBooks webhook delivery.
 *
 * Intuit signs the RAW request body with HMAC-SHA256 using your app's
 * verifier token (Developer portal → your app → Webhooks) and sends the
 * base64 digest in the `intuit-signature` header. This did NOT change in the
 * CloudEvents migration — only the payload shape did.
 *
 * Two rules this implementation encodes:
 *  - sign the raw bytes, not re-serialized JSON (JSON.stringify reordering
 *    or whitespace differences break the digest)
 *  - compare in constant time
 */
export function verifyIntuitSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  verifierToken: string,
): boolean {
  if (!signatureHeader || !verifierToken) return false;

  const expected = createHmac('sha256', verifierToken).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signatureHeader, 'base64');
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}
