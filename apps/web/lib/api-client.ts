import axios from 'axios';
import type {
  CreateJobResponse,
  JobStatusResponse,
  ProcessJobResponse,
  HealthResponse,
} from '@wearme/shared';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
  timeout: 135_000, // Allow up to 120s AI_REQUEST_TIMEOUT_SECONDS + buffer
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

export const tryOnApi = {
  /**
   * Upload person + garment images and create a pending job.
   */
  async upload(
    personImage: File,
    garmentImage: File,
    category: string,
  ): Promise<CreateJobResponse> {
    const form = new FormData();
    form.append('personImage', personImage);
    form.append('garmentImage', garmentImage);
    form.append('category', category);

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
   * Delete job and all images.
   */
  async deleteJob(jobId: string): Promise<void> {
    await apiClient.delete(`/try-on/${jobId}`);
  },

  /**
   * Health check.
   */
  async health(): Promise<HealthResponse> {
    const { data } = await apiClient.get<HealthResponse>('/health');
    return data;
  },
};
