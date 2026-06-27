export interface ApplyRequestBody {
  userId: string;
  name: string;
  phone: string;
}

export interface ExportJobPayload {
  programId: number;
  requestedBy: string;
}

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed';
