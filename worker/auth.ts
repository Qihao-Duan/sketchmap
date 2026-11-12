const encoder = new TextEncoder();

/** True when the request carries `Authorization: Bearer <ownerKey>`, compared in constant time. */
export function isOwner(request: Request, ownerKey: string): boolean {
  const match = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '');
  if (!match || !ownerKey) return false;
  const given = encoder.encode(match[1]);
  const expected = encoder.encode(ownerKey);
  if (given.byteLength !== expected.byteLength) {
    crypto.subtle.timingSafeEqual(expected, expected); // keep timing similar
    return false;
  }
  return crypto.subtle.timingSafeEqual(given, expected);
}
