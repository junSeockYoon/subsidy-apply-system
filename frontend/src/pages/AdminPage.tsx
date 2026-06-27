import { useCallback, useEffect, useState } from 'react';
import {
  AdminStats,
  fetchAdminStats,
  getExportStatus,
  requestExport,
  resetEnvironment,
  seedData,
} from '../api';

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportRowCount, setExportRowCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAdminStats();
      setStats(data);
    } catch {
      setActionMsg('API 서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!exportJobId) return;

    const poll = setInterval(async () => {
      const job = await getExportStatus(exportJobId);
      setExportStatus(job.status);
      if (job.status === 'completed' && job.result) {
        setExportRowCount(job.result.rowCount);
        clearInterval(poll);
      }
      if (job.status === 'failed') {
        setActionMsg(`Export 실패: ${job.failedReason}`);
        clearInterval(poll);
      }
    }, 1500);

    return () => clearInterval(poll);
  }, [exportJobId]);

  async function handleReset() {
    if (!confirm('신청 내역·Redis 쿼터를 초기화합니다. 계속할까요?')) return;
    setLoading(true);
    try {
      const data = await resetEnvironment();
      setStats(data);
      setActionMsg('환경이 초기화되었습니다.');
      setExportJobId(null);
      setExportStatus(null);
    } catch {
      setActionMsg('초기화 실패');
    } finally {
      setLoading(false);
    }
  }

  async function handleSeed(count: number) {
    setLoading(true);
    setActionMsg(`${count.toLocaleString()}건 시드 중... (잠시 기다려주세요)`);
    try {
      const data = await seedData(count);
      setStats(data);
      setActionMsg(`${count.toLocaleString()}건 시드 완료`);
    } catch {
      setActionMsg('시드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setActionMsg('엑셀 생성 Job 등록 중...');
    setExportJobId(null);
    setExportStatus(null);
    setExportRowCount(null);
    try {
      const job = await requestExport('admin-ui');
      setExportJobId(job.jobId);
      setExportStatus(job.status);
      setActionMsg(`Job 등록됨 (ID: ${job.jobId}). Worker가 실행 중이어야 합니다.`);
    } catch {
      setActionMsg('Export 요청 실패');
    }
  }

  const quotaPercent = stats
    ? Math.round((stats.program.remainingQuota / stats.program.totalQuota) * 100)
    : 0;

  return (
    <div className="page">
      <section className="hero admin-hero">
        <h1>관리자 대시보드</h1>
        <p>신청 현황 · 대용량 엑셀 다운로드 · 테스트 환경 관리</p>
      </section>

      {actionMsg && <div className="alert info">{actionMsg}</div>}

      {loading && !stats ? (
        <p>로딩 중...</p>
      ) : stats ? (
        <>
          <div className="stats-grid admin-stats">
            <div className="stat big">
              <span className="stat-label">잔여 쿼터 (DB)</span>
              <span className="stat-value">
                {stats.program.remainingQuota.toLocaleString()} /{' '}
                {stats.program.totalQuota.toLocaleString()}
              </span>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${quotaPercent}%` }} />
              </div>
            </div>
            <div className="stat">
              <span className="stat-label">Redis 잔여</span>
              <span className="stat-value">{stats.redisQuota.toLocaleString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">총 신청</span>
              <span className="stat-value">{stats.applicationCount.toLocaleString()}</span>
            </div>
            <div className="stat green">
              <span className="stat-label">성공 신청</span>
              <span className="stat-value">{stats.successCount.toLocaleString()}</span>
            </div>
          </div>

          <div className="grid-2">
            <section className="card">
              <h2>테스트 데이터 관리</h2>
              <p className="hint">
                대용량 엑셀 테스트 전 데이터를 넣습니다. 10만 건 이상은 터미널에서{' '}
                <code>npm run seed</code> 사용.
              </p>
              <div className="btn-row wrap">
                <button className="btn secondary" onClick={() => handleSeed(1000)}>
                  +1,000건
                </button>
                <button className="btn secondary" onClick={() => handleSeed(10000)}>
                  +10,000건
                </button>
                <button className="btn secondary" onClick={() => handleSeed(50000)}>
                  +50,000건
                </button>
                <button className="btn outline danger" onClick={handleReset}>
                  전체 초기화
                </button>
              </div>
            </section>

            <section className="card">
              <h2>대용량 엑셀 다운로드</h2>
              <p className="hint">
                API는 202 즉시 응답 → Worker가 MySQL Stream으로 엑셀 생성 (OOM 방지)
              </p>
              <div className="btn-row">
                <button className="btn primary" onClick={handleExport}>
                  엑셀 생성 요청
                </button>
                {exportJobId && exportStatus === 'completed' && (
                  <a
                    className="btn secondary"
                    href={`/api/export/${exportJobId}/download`}
                    download
                  >
                    다운로드 ({exportRowCount?.toLocaleString()}건)
                  </a>
                )}
              </div>
              {exportJobId && (
                <div className="export-status">
                  <p>
                    Job ID: <code>{exportJobId}</code>
                  </p>
                  <p>
                    상태: <strong>{exportStatus}</strong>
                    {exportRowCount != null && ` · ${exportRowCount.toLocaleString()}건`}
                  </p>
                </div>
              )}
              <p className="warn">
                ⚠️ Worker 미실행 시 Job이 대기 상태로 남습니다:{' '}
                <code>npm run dev:worker</code>
              </p>
            </section>
          </div>

          <section className="card">
            <h2>실제 10만 부하 테스트</h2>
            <p className="hint">
              브라우저 시뮬레이션은 수백~수천 건 수준입니다. 10만 동시 접속은 k6로
              테스트하세요.
            </p>
            <pre className="code-block">{`npm run loadtest:reset
npm run loadtest:good:smoke
npm run loadtest:reset
npm run loadtest:bad:smoke`}</pre>
          </section>
        </>
      ) : null}
    </div>
  );
}
