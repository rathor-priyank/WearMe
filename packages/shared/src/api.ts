export enum TryOnStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface CreateJobResponse {
  jobId: string;
  status: TryOnStatus;
  createdAt: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: TryOnStatus;
  category: string;
  personImageUrl?: string;
  garmentImageUrl?: string;
  resultUrl?: string;
  aiProvider?: string;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ProcessJobResponse {
  jobId: string;
  status: TryOnStatus;
  resultUrl?: string;
  errorMessage?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  services: {
    database: 'ok' | 'error';
    storage: 'ok' | 'error';
    ai: 'ok' | 'error';
  };
}

