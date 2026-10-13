import type { WardrobeUserProfile } from '@wearme/shared';

export interface LocalJobRecord {
  jobId: string;
  category: string;
  subcategory: string;
  createdAt: string;
}

export interface StoreQrContext {
  storeId: string;
  storeName: string;
  expiresAt?: string | null;
}

const STORAGE_KEY = 'wearme_session_jobs_v1';
const SESSION_ID_KEY = 'wearme_session_id_v1';
const LEGACY_AUTH_TOKEN_KEY = 'wearme_auth_token_v1';
const LOGGED_IN_COOKIE_NAME = 'wearme_logged_in_v1';
const USER_PROFILE_KEY = 'wearme_user_profile_v1';
const STORE_CONTEXT_KEY = 'wearme_store_context_v1';
const MAX_STORED_JOBS = 24;

// Volatile in-memory fallback token for the active tab only — never persisted to localStorage
let volatileAuthToken: string | null = null;

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `wm_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  const randomPart = Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return `wm_${Date.now().toString(16)}_${randomPart}`;
}

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(SESSION_ID_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,128}$/.test(existing)) {
      return existing;
    }
    const created = generateSessionId();
    window.localStorage.setItem(SESSION_ID_KEY, created);
    return created;
  } catch {
    return '';
  }
}

export function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    // Proactively purge any legacy raw token stored in localStorage
    if (window.localStorage.getItem(LEGACY_AUTH_TOKEN_KEY)) {
      window.localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
  return volatileAuthToken;
}

export const AUTH_COOKIE_NAME = LEGACY_AUTH_TOKEN_KEY;

export function isBrowserAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  if (volatileAuthToken) return true;
  try {
    if (/(?:^|;\s*)wearme_logged_in_v1=1(?:;|$)/.test(document.cookie)) {
      return true;
    }
    return getStoredUserProfile() !== null;
  } catch {
    return false;
  }
}

export function setStoredAuthSession(
  authToken: string,
  user: WardrobeUserProfile,
): void {
  if (typeof window === 'undefined') return;
  volatileAuthToken = authToken && authToken.startsWith('wm_auth_') ? authToken : null;
  try {
    // Never write raw authToken to localStorage
    window.localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
    const safeProfile: WardrobeUserProfile = {
      id: user.id,
      phoneE164: user.phoneE164 ?? null,
      email: user.email ?? null,
      name: user.name ?? null,
      basePersonImageUrl: user.basePersonImageUrl ?? null,
      originStoreId: user.originStoreId ?? null,
      originStoreName: user.originStoreName ?? null,
      createdAt: user.createdAt,
    };
    window.localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(safeProfile));
    document.cookie = `${LOGGED_IN_COOKIE_NAME}=1; Path=/; Max-Age=${30 * 86400}; SameSite=Lax`;
  } catch {
    // Ignore storage errors
  }
}

export function getStoredUserProfile(): WardrobeUserProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WardrobeUserProfile;
  } catch {
    return null;
  }
}

export function clearStoredAuthSession(): void {
  volatileAuthToken = null;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
    window.localStorage.removeItem(USER_PROFILE_KEY);
    document.cookie = `${LEGACY_AUTH_TOKEN_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
    document.cookie = `${LOGGED_IN_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // Ignore storage errors
  }
}

export function getStoredStoreContext(): StoreQrContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORE_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoreQrContext;
    if (parsed && typeof parsed.storeId === 'string') {
      if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
        window.localStorage.removeItem(STORE_CONTEXT_KEY);
        return null;
      }
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function setStoredStoreContext(ctx: StoreQrContext): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_CONTEXT_KEY, JSON.stringify(ctx));
  } catch {
    // Ignore storage errors
  }
}

export function clearStoredStoreContext(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORE_CONTEXT_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function getStoredJobRecords(): LocalJobRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalJobRecord =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as LocalJobRecord).jobId === 'string',
    );
  } catch {
    return [];
  }
}

export function recordSessionJob(entry: LocalJobRecord): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getStoredJobRecords().filter((j) => j.jobId !== entry.jobId);
    const updated = [entry, ...existing].slice(0, MAX_STORED_JOBS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota errors in private browsing
  }
}

export function removeSessionJob(jobId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const updated = getStoredJobRecords().filter((j) => j.jobId !== jobId);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Reconcile browser-stored job IDs against the authoritative list returned by the backend.
 * Any local job ID that is no longer present on the server (deleted or expired) is pruned
 * from localStorage so it is never resurrected as a fake PENDING job.
 */
export function reconcileSessionJobsWithBackend(
  activeBackendJobIds: Set<string>,
): LocalJobRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const existing = getStoredJobRecords();
    const filtered = existing.filter((rec) => activeBackendJobIds.has(rec.jobId));
    if (filtered.length !== existing.length) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    }
    return filtered;
  } catch {
    return [];
  }
}

export function clearSessionJobs(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
