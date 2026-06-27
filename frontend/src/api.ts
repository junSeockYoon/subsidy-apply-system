export interface ApplyResponse {
  status: 'success' | 'failed';
  applicationId?: number;
  reason?: string;
}

export interface AdminStats {
  program: {
    id: number;
    name: string;
    totalQuota: number;
    remainingQuota: number;
  };
  applicationCount: number;
  successCount: number;
  redisQuota: number;
}

export interface ExportJobResponse {
  jobId: string;
  status: string;
  message?: string;
  result?: {
    fileName: string;
    rowCount: number;
  };
  failedReason?: string;
}

export type ApiMode = 'good' | 'bad';

export async function applySubsidy(
  mode: ApiMode,
  body: { userId: string; name: string; phone: string },
): Promise<{ status: number; data: ApplyResponse }> {
  const res = await fetch(`/api/apply/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ApplyResponse;
  return { status: res.status, data };
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const res = await fetch('/api/admin/stats');
  if (!res.ok) throw new Error('통계 조회 실패');
  return res.json() as Promise<AdminStats>;
}

export async function resetEnvironment(): Promise<AdminStats> {
  const res = await fetch('/api/admin/reset', { method: 'POST' });
  if (!res.ok) throw new Error('초기화 실패');
  const json = (await res.json()) as { stats: AdminStats };
  return json.stats;
}

export async function seedData(count: number): Promise<AdminStats> {
  const res = await fetch('/api/admin/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) throw new Error('시드 실패');
  const json = (await res.json()) as { stats: AdminStats };
  return json.stats;
}

export async function requestExport(requestedBy: string): Promise<ExportJobResponse> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ programId: 1, requestedBy }),
  });
  return res.json() as Promise<ExportJobResponse>;
}

export async function getExportStatus(jobId: string): Promise<ExportJobResponse> {
  const res = await fetch(`/api/export/${jobId}`);
  return res.json() as Promise<ExportJobResponse>;
}

export interface BurstResult {
  success: number;
  quotaExhausted: number;
  tooBusy: number;
  alreadyApplied: number;
  errors: number;
  total: number;
  durationMs: number;
}

export async function runBurstSimulation(
  mode: ApiMode,
  count: number,
  onProgress?: (done: number, total: number) => void,
): Promise<BurstResult> {
  const start = Date.now();
  const result: BurstResult = {
    success: 0,
    quotaExhausted: 0,
    tooBusy: 0,
    alreadyApplied: 0,
    errors: 0,
    total: count,
    durationMs: 0,
  };

  const batchSize = 50;
  let done = 0;

  for (let offset = 0; offset < count; offset += batchSize) {
    const batch = Math.min(batchSize, count - offset);
    const tasks = Array.from({ length: batch }, (_, i) => {
      const idx = offset + i;
      const userId = `burst-${mode}-${Date.now()}-${idx}`;
      return applySubsidy(mode, {
        userId,
        name: `부하테스트${idx}`,
        phone: `010${String(10000000 + (idx % 89999999)).padStart(8, '0')}`,
      });
    });

    const responses = await Promise.allSettled(tasks);

    for (const r of responses) {
      if (r.status === 'rejected') {
        result.errors += 1;
        continue;
      }
      const { status, data } = r.value;
      if (status === 201) result.success += 1;
      else if (data.reason === 'QUOTA_EXHAUSTED') result.quotaExhausted += 1;
      else if (data.reason === 'TOO_BUSY') result.tooBusy += 1;
      else if (data.reason === 'ALREADY_APPLIED') result.alreadyApplied += 1;
      else result.errors += 1;
    }

    done += batch;
    onProgress?.(done, count);
  }

  result.durationMs = Date.now() - start;
  return result;
}
