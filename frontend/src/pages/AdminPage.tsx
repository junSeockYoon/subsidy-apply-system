import { useCallback, useEffect, useState } from 'react';
import {
  AdminApplicationItem,
  AdminStats,
  ApiRequestError,
  clearAllApplications,
  createAdminApplication,
  fetchAdminStats,
  fetchRecentApplications,
  getExportStatus,
  requestExport,
  seedData,
} from '../api';
import FeedbackAlert from '../components/FeedbackAlert';
import { EXPORT_STATUS_LABELS, mapApplyFailure, mapNetworkError, UserMessage } from '../errors';

function randomUserId() {
  return `admin-${crypto.randomUUID().slice(0, 8)}`;
}

function randomPhone() {
  return `010${String(10000000 + Math.floor(Math.random() * 89999999)).padStart(8, '0')}`;
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [applications, setApplications] = useState<AdminApplicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<UserMessage | null>(null);

  const [userId, setUserId] = useState(randomUserId);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(randomPhone());
  const [submitting, setSubmitting] = useState(false);

  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportRowCount, setExportRowCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [statsData, apps] = await Promise.all([
        fetchAdminStats(),
        fetchRecentApplications(30),
      ]);
      setStats(statsData);
      setApplications(apps);
    } catch (error) {
      setStats(null);
      setApplications([]);
      setFeedback(
        error instanceof ApiRequestError && error.status === 0
          ? mapNetworkError(error)
          : {
              title: '데이터 조회 실패',
              message: '관리자 데이터를 불러올 수 없습니다.',
              hint: 'npm run dev:api 및 Docker(MySQL·Redis) 상태를 확인하세요.',
              type: 'err',
            },
      );
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
      try {
        const job = await getExportStatus(exportJobId);
        setExportStatus(job.status);

        if (job.status === 'completed' && job.result) {
          setExportRowCount(job.result.rowCount);
          setFeedback({
            title: '엑셀 생성 완료',
            message: `${job.result.rowCount.toLocaleString()}건 다운로드 가능`,
            type: 'ok',
          });
          clearInterval(poll);
        }

        if (job.status === 'failed') {
          setFeedback({
            title: '엑셀 생성 실패',
            message: job.failedReason ?? 'Worker 처리 실패',
            hint: 'npm run dev:worker 실행 여부를 확인하세요.',
            type: 'err',
          });
          clearInterval(poll);
        }
      } catch (error) {
        setFeedback(mapNetworkError(error));
        clearInterval(poll);
      }
    }, 1500);

    return () => clearInterval(poll);
  }, [exportJobId]);

  async function handleCreateApplication(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await createAdminApplication({ userId, name, phone });
      setStats(result.stats);
      setFeedback({
        title: '신청 등록 완료',
        message: `신청번호 ${result.applicationId}번이 등록되었습니다. (쿼터 1건 차감)`,
        type: 'ok',
      });
      setUserId(randomUserId());
      setName('');
      setPhone(randomPhone());
      void refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const body = error.body as { reason?: string; details?: Record<string, string[] | undefined> };
        if (error.status === 0) {
          setFeedback(mapNetworkError(error));
        } else {
          setFeedback(mapApplyFailure(body?.reason, error.status, body?.details));
        }
      } else {
        setFeedback(mapNetworkError(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClearDb() {
    if (
      !confirm(
        '모든 신청 내역을 삭제하고 쿼터를 10,000건으로 복원합니다.\n이 작업은 되돌릴 수 없습니다. 계속할까요?',
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const data = await clearAllApplications();
      setStats(data);
      setApplications([]);
      setFeedback({
        title: 'DB 비우기 완료',
        message: '신청 내역이 삭제되고 쿼터·Redis가 초기화되었습니다.',
        type: 'ok',
      });
      void refresh();
    } catch (error) {
      setFeedback(
        error instanceof ApiRequestError
          ? {
              title: 'DB 비우기 실패',
              message: `서버 오류 (HTTP ${error.status})`,
              type: 'err',
            }
          : mapNetworkError(error),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSeed(count: number) {
    setLoading(true);
    setFeedback({
      title: '시드 진행 중',
      message: `${count.toLocaleString()}건 삽입 중...`,
      type: 'info',
    });
    try {
      const data = await seedData(count);
      setStats(data);
      setFeedback({
        title: '시드 완료',
        message: `${count.toLocaleString()}건 추가됨 (쿼터는 차감되지 않음)`,
        hint: '시드는 DB에만 넣습니다. 쿼터와 맞추려면 「DB 비우기」 후 선착순 API로 테스트하세요.',
        type: 'ok',
      });
      void refresh();
    } catch (error) {
      setFeedback({
        title: '시드 실패',
        message: error instanceof ApiRequestError ? `HTTP ${error.status}` : '실패',
        type: 'err',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setExportJobId(null);
    setExportStatus(null);
    setExportRowCount(null);
    try {
      const job = await requestExport('admin-ui');
      setExportJobId(job.jobId);
      setExportStatus(job.status);
      setFeedback({
        title: 'Job 등록됨',
        message: `Job ID: ${job.jobId}`,
        hint: EXPORT_STATUS_LABELS.waiting,
        type: 'info',
      });
    } catch (error) {
      setFeedback(mapNetworkError(error));
    }
  }

  const quotaPercent = stats
    ? Math.round((stats.program.remainingQuota / stats.program.totalQuota) * 100)
    : 0;

  const isSoldOut = stats != null && stats.program.remainingQuota <= 0;

  return (
    <div className="page">
      <section className="hero admin-hero">
        <h1>관리자 대시보드</h1>
        <p>신청 등록 · 데이터 관리 · 엑셀 다운로드</p>
      </section>

      <FeedbackAlert feedback={feedback} onClose={() => setFeedback(null)} />

      {loading && !stats ? (
        <p>로딩 중...</p>
      ) : stats ? (
        <>
          {isSoldOut && (
            <div className="quota-banner sold-out">
              <div>
                <strong>선착순 마감</strong>
                <span className="quota-numbers">「DB 비우기」로 쿼터를 복원할 수 있습니다.</span>
              </div>
              <span className="quota-badge">마감</span>
            </div>
          )}

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
              <span className="stat-label">성공</span>
              <span className="stat-value">{stats.successCount.toLocaleString()}</span>
            </div>
          </div>

          <div className="grid-2">
            <section className="card">
              <h2>신규 신청 등록</h2>
              <p className="hint">
                관리자가 직접 신청 1건을 등록합니다. 쿼터가 1건 차감되고 DB·Redis에
                반영됩니다.
              </p>
              <form onSubmit={handleCreateApplication} className="form">
                <label>
                  사용자 ID
                  <div className="input-row">
                    <input
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="btn outline small"
                      onClick={() => setUserId(randomUserId())}
                    >
                      새 ID
                    </button>
                  </div>
                </label>
                <label>
                  이름
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="홍길동"
                    required
                  />
                </label>
                <label>
                  전화번호
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01012345678"
                    required
                  />
                </label>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={submitting || isSoldOut}
                >
                  {submitting ? '등록 중...' : isSoldOut ? '쿼터 마감' : '신청 등록'}
                </button>
              </form>
            </section>

            <section className="card">
              <h2>DB · 테스트 데이터</h2>
              <p className="hint">
                <strong>DB 비우기:</strong> 신청 전체 삭제 + 쿼터 10,000 복원
                <br />
                <strong>시드:</strong> 테스트용 대량 데이터만 추가 (쿼터 미차감)
              </p>
              <div className="btn-row wrap">
                <button className="btn outline danger" onClick={handleClearDb}>
                  DB 비우기 (전체 삭제)
                </button>
                <button className="btn secondary" onClick={() => handleSeed(1000)}>
                  +1,000건 시드
                </button>
                <button className="btn secondary" onClick={() => handleSeed(10000)}>
                  +10,000건 시드
                </button>
              </div>
            </section>
          </div>

          <section className="card">
            <div className="card-header-row">
              <h2>최근 신청 내역</h2>
              <button type="button" className="btn outline small" onClick={() => void refresh()}>
                새로고침
              </button>
            </div>
            {applications.length === 0 ? (
              <p className="hint">등록된 신청이 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>사용자ID</th>
                      <th>이름</th>
                      <th>전화번호</th>
                      <th>상태</th>
                      <th>신청일시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app) => (
                      <tr key={app.id}>
                        <td>{app.id}</td>
                        <td>
                          <code>{app.userId}</code>
                        </td>
                        <td>{app.name}</td>
                        <td>{app.phone}</td>
                        <td>
                          <span className={`status-pill ${app.status}`}>{app.status}</span>
                        </td>
                        <td>{new Date(app.createdAt).toLocaleString('ko-KR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>대용량 엑셀 다운로드</h2>
            <p className="hint">Worker(npm run dev:worker) 실행 필요</p>
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
                  Job: <code>{exportJobId}</code> · 상태: <strong>{exportStatus}</strong>
                </p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
