import axios from 'axios';
import {
  WEARABLE_CATALOG,
  type CategoriesResponse,
  type CreateJobResponse,
  type HealthResponse,
  type JobHistoryResponse,
  type JobStatusResponse,
  type ProcessJobResponse,
  type RequestOtpPayload,
  type RequestOtpResponse,
  type UpgradeSessionPayload,
  type UpgradeSessionResponse,
  type WardrobeResponse,
} from '@wearme/shared';
import { getOrCreateSessionId, getStoredAuthToken } from './job-history';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
  timeout: 135_000, // Allow up to 120s AI_REQUEST_TIMEOUT_SECONDS + buffer
});

// Request interceptor — attach per-browser session ID header and optional wardrobe auth token
apiClient.interceptors.request.use((config) => {
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
  ): Promise<CreateJobResponse> {
    const form = new FormData();
    form.append('personImage', personImage);
    form.append('garmentImage', garmentImage);
    form.append('category', category);
    if (subcategory) {
      form.append('subcategory', subcategory);
    }

    const { data } = await apiClient.post<CreateJobResponse>('/try-on/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
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
   * Request a WhatsApp OTP verification code for the active x-wearme-session-id.
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
};
