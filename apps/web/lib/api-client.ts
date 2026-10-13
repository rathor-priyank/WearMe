import axios from 'axios';
import {
  WEARABLE_CATALOG,
  type AuthChannelsResponse,
  type CategoriesResponse,
  type ContactInquiryPayload,
  type ContactInquiryResponse,
  type CreateJobResponse,
  type DeleteAccountResponse,
  type DeletePortraitResponse,
  type EntitlementStatusResponse,
  type HealthResponse,
  type JobHistoryResponse,
  type JobStatusResponse,
  type PartnerStoreAnalyticsResponse,
  type PartnerStoreAuthResponse,
  type PartnerStorePublicInfo,
  type PartnerStoreQrTokenResponse,
  type PartnerStoreSubscriptionResponse,
  type PartnerStoreUsageResponse,
  type ProcessJobResponse,
  type RequestOtpPayload,
  type RequestOtpResponse,
  type SponsoredSessionStateResponse,
  type UpgradeSessionPayload,
  type UpgradeSessionResponse,
  type WardrobeResponse,
} from '@wearme/shared';
import { getOrCreateSessionId, getStoredAuthToken } from './job-history';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
  timeout: 135_000, // Allow up to 120s AI_REQUEST_TIMEOUT_SECONDS + buffer
  withCredentials: true,
});

// Request interceptor — attach per-browser session ID header, CSRF header, and optional volatile auth token
apiClient.interceptors.request.use((config) => {
  config.headers.set('x-wearme-csrf', '1');
  const sessionId = getOrCreateSessionId();
  if (sessionId) {
    config.headers.set('x-wearme-session-id', sessionId);
  }
  const authToken = getStoredAuthToken();
  if (authToken) {
    config.headers.set('x-wearme-auth-token', authToken);
    config.headers.set('Authorization', `Bearer ${authToken}`);
  }
  return config;
});

// Response interceptor — normalize errors into a consistent user-safe message
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const rawMsg = error.response?.data?.message ?? error.response?.data?.error;
    const message = Array.isArray(rawMsg)
      ? rawMsg.join('. ')
      : (rawMsg ?? error.message ?? 'An unexpected error occurred');
    return Promise.reject(new Error(String(message)));
  },
);

export function buildFallbackCategoriesResponse(): CategoriesResponse {
  return {
    activeProvider: 'mock',
    necklacePocEnabled: false,
    categories: WEARABLE_CATALOG.map((item) => ({
      subcategory: item.subcategory,
      domain: item.domain,
      dbCategory: item.dbCategory,
      label: item.label,
      targetBodyRegion: item.targetBodyRegion,
      requiredLandmarks: [...item.requiredLandmarks],
      routingStrategy: item.routingStrategy,
      idmVtonCompatible: item.idmVtonCompatible,
      fashnV16Category: item.fashnV16Category,
      liveValidationStatus: item.liveValidationStatus,
      providerSupportStatus: item.defaultSupportStatus,
      selectedRoute:
        item.defaultSupportStatus === 'supported' ? item.routingStrategy : null,
    })),
  };
}

export const tryOnApi = {
  /**
   * Upload person + garment/product images and create a pending job.
   */
  async upload(
    personImage: File,
    garmentImage: File,
    category: string,
    subcategory?: string,
    storeId?: string,
    idempotencyKey?: string,
  ): Promise<CreateJobResponse> {
    const form = new FormData();
    form.append('personImage', personImage);
    form.append('garmentImage', garmentImage);
    form.append('category', category);
    if (subcategory) {
      form.append('subcategory', subcategory);
    }
    if (storeId) {
      form.append('storeId', storeId);
    }
    if (idempotencyKey) {
      form.append('idempotencyKey', idempotencyKey);
    }

    const { data } = await apiClient.post<CreateJobResponse>('/try-on/upload', form, {
      headers: {
        'Content-Type': 'multipart/form-data',
        ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
      },
    });
    return data;
  },

  /**
   * Trigger inference for an uploaded job.
   */
  async process(jobId: string): Promise<ProcessJobResponse> {
    const { data } = await apiClient.post<ProcessJobResponse>(`/try-on/${jobId}/process`);
    return data;
  },

  /**
   * Poll job status.
   */
  async getStatus(jobId: string): Promise<JobStatusResponse> {
    const { data } = await apiClient.get<JobStatusResponse>(`/try-on/${jobId}/status`);
    return data;
  },

  /**
   * Fetch the 38-item wearable category capability matrix from the backend,
   * falling back to the shared catalog if the backend is unreachable.
   */
  async getCategories(): Promise<CategoriesResponse> {
    try {
      const { data } = await apiClient.get<CategoriesResponse>('/try-on/categories', {
        timeout: 5000,
      });
      return data;
    } catch {
      return buildFallbackCategoriesResponse();
    }
  },

  /**
   * List recent non-expired jobs from the backend.
   */
  async listJobs(ids?: string[]): Promise<JobHistoryResponse> {
    const params = ids && ids.length > 0 ? { ids: ids.join(',') } : undefined;
    const { data } = await apiClient.get<JobHistoryResponse>('/try-on/jobs', {
      params,
      timeout: 8000,
    });
    return data;
  },

  /**
   * Delete job and all images.
   */
  async deleteJob(jobId: string): Promise<void> {
    await apiClient.delete(`/try-on/${jobId}`);
  },

  /**
   * Health check.
   */
  async health(): Promise<HealthResponse> {
    const { data } = await apiClient.get<HealthResponse>('/health', { timeout: 5000 });
    return data;
  },

  /**
   * List available OTP authentication channels (WhatsApp, SMS, Email).
   */
  async getAuthChannels(): Promise<AuthChannelsResponse> {
    const { data } = await apiClient.get<AuthChannelsResponse>('/auth/channels', {
      timeout: 5_000,
    });
    return data;
  },

  /**
   * Request a WhatsApp, SMS, or Email OTP verification code for the active x-wearme-session-id.
   */
  async requestOtp(payload: RequestOtpPayload): Promise<RequestOtpResponse> {
    const { data } = await apiClient.post<RequestOtpResponse>('/auth/request-otp', payload, {
      timeout: 10_000,
    });
    return data;
  },

  /**
   * Verify OTP and atomically upgrade the anonymous TryOnSession into a persistent User wardrobe.
   */
  async upgradeSession(payload: UpgradeSessionPayload): Promise<UpgradeSessionResponse> {
    const { data } = await apiClient.post<UpgradeSessionResponse>(
      '/auth/upgrade-session',
      payload,
      { timeout: 15_000 },
    );
    return data;
  },

  /**
   * Sign out the current session and clear HttpOnly auth cookies.
   */
  async logout(): Promise<{ loggedOut: boolean }> {
    const { data } = await apiClient.post<{ loggedOut: boolean }>(
      '/auth/logout',
      {},
      { timeout: 8_000 },
    );
    return data;
  },

  /**
   * Fetch the authenticated user's digital wardrobe (/my-wardrobe).
   */
  async getWardrobe(): Promise<WardrobeResponse> {
    const { data } = await apiClient.get<WardrobeResponse>('/wardrobe', {
      timeout: 10_000,
    });
    return data;
  },

  /**
   * Save an existing completed job to an already-authenticated user's wardrobe.
   */
  async saveJobToWardrobe(jobId: string): Promise<JobStatusResponse> {
    const { data } = await apiClient.post<JobStatusResponse>(
      `/wardrobe/save-job/${jobId}`,
      {},
      { timeout: 10_000 },
    );
    return data;
  },

  /**
   * Run a 1-click cross-retailer virtual try-on using the user's saved base portrait.
   */
  async tryOnFromCatalog(catalogItemId: string): Promise<JobStatusResponse> {
    const { data } = await apiClient.post<JobStatusResponse>(
      '/wardrobe/try-on',
      { catalogItemId },
      { timeout: 135_000 },
    );
    return data;
  },

  /**
   * Delete the authenticated customer's saved base portrait.
   */
  async deletePortrait(): Promise<DeletePortraitResponse> {
    const { data } = await apiClient.delete<DeletePortraitResponse>('/wardrobe/portrait', {
      timeout: 10_000,
    });
    return data;
  },

  /**
   * Permanently delete the authenticated customer's account, saved portrait, and all saved jobs.
   */
  async deleteAccount(): Promise<DeleteAccountResponse> {
    const { data } = await apiClient.delete<DeleteAccountResponse>('/wardrobe/account', {
      timeout: 15_000,
    });
    return data;
  },

  /**
   * Resolve verified boutique public metadata by storeId so client UI never trusts URL storeName params.
   */
  async getPublicStoreInfo(storeId: string): Promise<PartnerStorePublicInfo> {
    const { data } = await apiClient.get<PartnerStorePublicInfo>(
      `/wardrobe/stores/${encodeURIComponent(storeId)}/public`,
      { timeout: 5_000 },
    );
    return data;
  },

  /**
   * Start or inspect a bounded Store-Sponsored QR Session.
   * Note: Page refresh NEVER resets session lifetime; renewing an expired session requires a single-use signed qrToken.
   */
  async startOrInspectSponsoredSession(
    storeId: string,
    qrToken?: string | null,
  ): Promise<SponsoredSessionStateResponse> {
    const { data } = await apiClient.post<SponsoredSessionStateResponse>(
      `/wardrobe/stores/${encodeURIComponent(storeId)}/sessions`,
      {
        forceRefreshScan: false,
        ...(qrToken ? { qrToken } : {}),
      },
      { timeout: 8_000 },
    );
    return data;
  },

  /**
   * Fetch current effective billing mode, store-sponsored session state, and personal try-on entitlement.
   */
  async getEntitlements(): Promise<EntitlementStatusResponse> {
    const { data } = await apiClient.get<EntitlementStatusResponse>('/entitlements/me', {
      timeout: 8_000,
    });
    return data;
  },

  /**
   * Explicitly switch the current session from an expired/active store session to Personal WearMe mode.
   */
  async switchToPersonalMode(): Promise<EntitlementStatusResponse> {
    const { data } = await apiClient.post<EntitlementStatusResponse>(
      '/entitlements/session/switch-personal',
      {},
      { timeout: 8_000 },
    );
    return data;
  },

  /**
   * Authenticate a boutique partner API key for production partner dashboard access.
   */
  async authenticatePartnerStore(
    storeId: string,
    partnerKey: string,
  ): Promise<PartnerStoreAuthResponse> {
    const { data } = await apiClient.post<PartnerStoreAuthResponse>(
      `/partner/stores/${encodeURIComponent(storeId)}/auth`,
      { apiKey: partnerKey },
      {
        headers: {
          'x-wearme-partner-store-id': storeId,
          'x-wearme-partner-key': partnerKey,
        },
        timeout: 8_000,
      },
    );
    return data;
  },

  /**
   * Explicitly authorize and renew a PartnerStoreSubscription for a new 30-day billing period.
   */
  async renewPartnerStoreSubscription(
    storeId: string,
    partnerKey: string,
    planId?: string,
  ): Promise<PartnerStoreSubscriptionResponse> {
    const { data } = await apiClient.post<PartnerStoreSubscriptionResponse>(
      `/partner/stores/${encodeURIComponent(storeId)}/subscription/renew`,
      planId ? { planId } : {},
      {
        headers: {
          'x-wearme-partner-store-id': storeId,
          'x-wearme-partner-key': partnerKey,
        },
        timeout: 8_000,
      },
    );
    return data;
  },

  /**
   * Issue a short-lived, single-use signed QR check-in token for in-store session renewal.
   */
  async issuePartnerStoreQrToken(
    storeId: string,
    partnerKey?: string,
    ttlSeconds = 300,
  ): Promise<PartnerStoreQrTokenResponse> {
    const { data } = await apiClient.post<PartnerStoreQrTokenResponse>(
      `/partner/stores/${encodeURIComponent(storeId)}/qr-token`,
      { ttlSeconds },
      {
        headers: {
          'x-wearme-partner-store-id': storeId,
          ...(partnerKey ? { 'x-wearme-partner-key': partnerKey } : {}),
        },
        timeout: 8_000,
      },
    );
    return data;
  },

  /**
   * Fetch PartnerStoreSubscription details for a boutique.
   */
  async getPartnerStoreSubscription(
    storeId: string,
    partnerKey?: string,
  ): Promise<PartnerStoreSubscriptionResponse> {
    const { data } = await apiClient.get<PartnerStoreSubscriptionResponse>(
      `/partner/stores/${encodeURIComponent(storeId)}/subscription`,
      {
        headers: {
          'x-wearme-partner-store-id': storeId,
          ...(partnerKey ? { 'x-wearme-partner-key': partnerKey } : {}),
        },
        timeout: 8_000,
      },
    );
    return data;
  },

  /**
   * Fetch aggregated PartnerStoreUsageResponse for a boutique.
   */
  async getPartnerStoreUsage(
    storeId: string,
    partnerKey?: string,
  ): Promise<PartnerStoreUsageResponse> {
    const { data } = await apiClient.get<PartnerStoreUsageResponse>(
      `/partner/stores/${encodeURIComponent(storeId)}/usage`,
      {
        headers: {
          'x-wearme-partner-store-id': storeId,
          ...(partnerKey ? { 'x-wearme-partner-key': partnerKey } : {}),
        },
        timeout: 8_000,
      },
    );
    return data;
  },

  /**
   * Fetch privacy-preserving aggregated metrics for a partner boutique.
   */
  async getPartnerStoreAnalytics(
    storeId: string,
    partnerKey?: string,
  ): Promise<PartnerStoreAnalyticsResponse> {
    const { data } = await apiClient.get<PartnerStoreAnalyticsResponse>(
      `/wardrobe/stores/${encodeURIComponent(storeId)}/analytics`,
      {
        headers: {
          'x-wearme-partner-store-id': storeId,
          ...(partnerKey ? { 'x-wearme-partner-key': partnerKey } : {}),
        },
        timeout: 8_000,
      },
    );
    return data;
  },

  /**
   * Submit a validated business, partnership, privacy, or customer support inquiry.
   */
  async submitContactInquiry(payload: ContactInquiryPayload): Promise<ContactInquiryResponse> {
    const { data } = await apiClient.post<ContactInquiryResponse>(
      '/wardrobe/contact',
      payload,
      { timeout: 8_000 },
    );
    return data;
  },
};
