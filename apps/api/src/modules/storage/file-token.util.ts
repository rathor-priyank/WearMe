import * as crypto from 'crypto';

const DEFAULT_DEV_SECRET = 'wearme-flywheel-local-hmac-secret-v1';
const DEFAULT_FILE_URL_TTL_MS = 60 * 60 * 1000; // 1 hour

export function resolveSigningSecret(customSecret?: string): string {
  const secret = customSecret ?? process.env['AUTH_TOKEN_SECRET'] ?? DEFAULT_DEV_SECRET;
  if (process.env['NODE_ENV'] === 'production' && secret === DEFAULT_DEV_SECRET) {
    throw new Error(
      'CRITICAL SECURITY ERROR: AUTH_TOKEN_SECRET must be explicitly set to a strong secret in production.',
    );
  }
  return secret;
}

export function createFileSignature(
  storageKey: string,
  expiresAtMs: number,
  customSecret?: string,
): string {
  const secret = resolveSigningSecret(customSecret);
  return crypto
    .createHmac('sha256', secret)
    .update(`file:${storageKey}:${expiresAtMs}`)
    .digest('base64url');
}

export function appendSignedFileQuery(
  rawUrl: string,
  storageKey: string,
  ttlMs = DEFAULT_FILE_URL_TTL_MS,
  customSecret?: string,
): string {
  const exp = Date.now() + ttlMs;
  const sig = createFileSignature(storageKey, exp, customSecret);
  const separator = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${separator}exp=${exp}&sig=${sig}`;
}

export function verifySignedFileQuery(
  storageKey: string,
  expParam?: string,
  sigParam?: string,
  customSecret?: string,
): boolean {
  if (!expParam || !sigParam) {
    return false;
  }
  const exp = Number(expParam);
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    return false;
  }
  const expectedSig = createFileSignature(storageKey, exp, customSecret);
  const actualBuf = Buffer.from(sigParam, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export interface VerifiedCustomerAuthPayload {
  sub: string;
  phoneE164?: string | null;
  email?: string | null;
  sessionToken: string;
  iat: number;
  exp: number;
}

export function extractAuthTokenFromCookieHeader(cookieHeader?: string): string | undefined {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return undefined;
  }
  const match = /(?:^|;\s*)wearme_auth_token_v1=([^;]+)/.exec(cookieHeader);
  if (!match?.[1]) {
    return undefined;
  }
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

export function extractSessionIdFromCookieHeader(cookieHeader?: string): string | undefined {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return undefined;
  }
  const match = /(?:^|;\s*)wearme_session_id_v1=([^;]+)/.exec(cookieHeader);
  if (!match?.[1]) {
    return undefined;
  }
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

export function verifyCustomerAuthToken(
  rawToken?: string,
  customSecret?: string,
): VerifiedCustomerAuthPayload | null {
  if (!rawToken || typeof rawToken !== 'string') {
    return null;
  }
  const cleaned = rawToken.replace(/^Bearer\s+/i, '').trim();
  if (!cleaned.startsWith('wm_auth_')) {
    return null;
  }
  const withoutPrefix = cleaned.slice('wm_auth_'.length);
  const dotIndex = withoutPrefix.indexOf('.');
  if (dotIndex <= 0) {
    return null;
  }
  const encodedPayload = withoutPrefix.slice(0, dotIndex);
  const signature = withoutPrefix.slice(dotIndex + 1);

  const secret = resolveSigningSecret(customSecret);
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as VerifiedCustomerAuthPayload;
    if (!parsed.sub || !parsed.exp || parsed.exp <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
