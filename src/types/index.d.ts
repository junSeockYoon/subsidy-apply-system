export interface ApplyRequestBody {
  userId: string;
  name: string;
  phone: string;
}

export interface ExportJobPayload {
  programId: number;
  requestedBy: string;
}

export interface ExportJobResult {
  fileName: string;
  filePath: string;
  rowCount: number;
}

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed';
