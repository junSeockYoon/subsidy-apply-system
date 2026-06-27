import path from 'path';
import fs from 'fs/promises';
import { Queue } from 'bullmq';
import { config } from '../../config';
import { EXPORT_QUEUE_NAME, getBullmqConnection } from '../../config/bullmq';
import { ExportJobPayload, ExportJobResult, JobStatus } from '../../types';

let exportQueue: Queue<ExportJobPayload, ExportJobResult> | null = null;

function getExportQueue(): Queue<ExportJobPayload, ExportJobResult> {
  if (!exportQueue) {
    exportQueue = new Queue<ExportJobPayload, ExportJobResult>(EXPORT_QUEUE_NAME, {
      connection: getBullmqConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400 },
      },
    });
  }

  return exportQueue;
}

export async function ensureExportStorageDir(): Promise<string> {
  const dir = path.resolve(process.cwd(), config.EXPORT_STORAGE_PATH);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * 엑셀 생성 Job enqueue
 * 성능 이점: API는 큐에 넣고 즉시 202 반환 — 무거운 I/O는 워커로 위임
 */
export async function enqueueExportJob(
  payload: ExportJobPayload,
): Promise<{ jobId: string; status: JobStatus }> {
  const job = await getExportQueue().add('generate-excel', payload);
  return { jobId: String(job.id), status: 'waiting' };
}

function mapBullState(state: string): JobStatus {
  const map: Record<string, JobStatus> = {
    waiting: 'waiting',
    'waiting-children': 'waiting',
    delayed: 'waiting',
    prioritized: 'waiting',
    active: 'active',
    completed: 'completed',
    failed: 'failed',
  };
  return map[state] ?? 'waiting';
}

export interface ExportJobStatusResponse {
  jobId: string;
  status: JobStatus;
  result?: ExportJobResult;
  failedReason?: string;
  progress?: number;
}

export async function getExportJobStatus(
  jobId: string,
): Promise<ExportJobStatusResponse | null> {
  const job = await getExportQueue().getJob(jobId);
  if (!job) {
    return null;
  }

  const state = await job.getState();

  return {
    jobId: String(job.id),
    status: mapBullState(state),
    result: job.returnvalue ?? undefined,
    failedReason: job.failedReason ?? undefined,
    progress: typeof job.progress === 'number' ? job.progress : undefined,
  };
}

export function resolveExportFilePath(fileName: string): string {
  return path.resolve(process.cwd(), config.EXPORT_STORAGE_PATH, fileName);
}

export async function closeExportQueue(): Promise<void> {
  if (exportQueue) {
    await exportQueue.close();
    exportQueue = null;
  }
}
