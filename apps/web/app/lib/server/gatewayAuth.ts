/**
 * Server-only: headers that authenticate this app's API routes to the Tool
 * Gateway. GATEWAY_SERVICE_KEY must never be a NEXT_PUBLIC_ variable — the
 * gateway is service-to-service, and the key is only read on the server.
 */
export function gatewayHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = process.env.GATEWAY_SERVICE_KEY?.trim();
  return key ? { ...extra, "X-Service-Key": key } : { ...extra };
}
