import { useCallback, useEffect, useState } from 'react';
import {
  ApiMode,
  ApiRequestError,
  applySubsidy,
  AdminStats,
  BurstResult,
  fetchAdminStats,
  runBurstSimulation,
} from '../api';
import FeedbackAlert from '../components/FeedbackAlert';
import {
  mapApplyFailure,
  mapNetworkError,
  mapSuccess,
  UserMessage,
} from '../errors';

function randomUserId() {
  return `user-${crypto.randomUUID().slice(0, 8)}`;
}

function randomPhone() {
  return `010${String(10000000 + Math.floor(Math.random() * 89999999)).padStart(8, '0')}`;
}

export default function UserPage() {
  const [userId, setUserId] = useState(randomUserId);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(randomPhone());
  const [mode, setMode] = useState<ApiMode>('good');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<UserMessage | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState<UserMessage | null>(null);

  const [burstCount, setBurstCount] = useState(100);
  const [burstMode, setBurstMode] = useState<ApiMode>('good');
  const [burstRunning, setBurstRunning] = useState(false);
  const [burstProgress, setBurstProgress] = useState(0);
  const [burstResult, setBurstResult] = useState<BurstResult | null>(null);
  const [compareResult, setCompareResult] = useState<{
    good: BurstResult;
    bad: BurstResult;
  } | null>(null);

  const refreshStats = useCallback(async () => {
    try {
      const data = await fetchAdminStats();
      setStats(data);
      setStatsError(null);
    } catch (error) {
      setStats(null);
      setStatsError(
        error instanceof ApiRequestError && error.status === 0
          ? mapNetworkError(error)
          : {
              title: '현황 조회 실패',
              message: '잔여 쿼터를 불러올 수 없습니다.',
              hint: 'API 서버(npm run dev:api)가 실행 중인지 확인하세요.',
              type: 'err',
            },
      );
    }
  }, []);

  useEffect(() => {
    void refreshStats();
    const timer = setInterval(() => void refreshStats(), 5000);
    return () => clearInterval(timer);
  }, [refreshStats]);

  const isSoldOut =
    stats != null &&
    stats.program.remainingQuota <= 0 &&
    stats.redisQuota <= 0;

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFeedback(null);

    if (isSoldOut) {
      setFeedback(mapApplyFailure('QUOTA_EXHAUSTED', 409));
      setLoading(false);
      return;
    }

    try {
      const { status, data } = await applySubsidy(mode, { userId, name, phone });

      if (status === 201 && data.status === 'success') {
        setFeedback(mapSuccess(data.applicationId));
        setUserId(randomUserId());
        void refreshStats();
      } else {
        setFeedback(
          mapApplyFailure(data.reason, status, data.details),
        );
      }
    } catch (error) {
      setFeedback(
        error instanceof ApiRequestError && error.status === 0
          ? mapNetworkError(error)
          : mapNetworkError(error),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleBurst() {
    setBurstRunning(true);
    setBurstResult(null);
    setBurstProgress(0);
    setFeedback(null);
    try {
      const result = await runBurstSimulation(burstMode, burstCount, (done, total) => {
        setBurstProgress(Math.round((done / total) * 100));
      });
      setBurstResult(result);
      void refreshStats();

      if (result.success === 0 && result.quotaExhausted > 0) {
        setFeedback(mapApplyFailure('QUOTA_EXHAUSTED', 409));
      } else {
        setFeedback({
          title: '시뮬레이션 완료',
          message: `성공 ${result.success}건 · 마감 ${result.quotaExhausted}건 · 과부하 ${result.tooBusy}건 · 오류 ${result.errors}건`,
          type: 'info',
        });
      }
    } catch (error) {
      setFeedback(mapNetworkError(error));
    } finally {
      setBurstRunning(false);
    }
  }

  async function handleCompare() {
    setBurstRunning(true);
    setCompareResult(null);
    setFeedback({
      title: '비교 테스트 진행 중',
      message: 'Good API 테스트 중...',
      type: 'info',
    });
    try {
      const good = await runBurstSimulation('good', burstCount);
      setFeedback({
        title: '비교 테스트 진행 중',
        message: 'Bad API 테스트 중...',
        type: 'info',
      });
      const bad = await runBurstSimulation('bad', burstCount);
      setCompareResult({ good, bad });
      setFeedback({
        title: '비교 완료',
        message: `Good 성공 ${good.success}건 / Bad 성공 ${bad.success}건 — Bad가 더 많거나 오류가 크면 race condition 신호입니다.`,
        type: 'info',
      });
      void refreshStats();
    } catch (error) {
      setFeedback(mapNetworkError(error));
    } finally {
      setBurstRunning(false);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <h1>대국민 금융 지원금 신청</h1>
        <p>선착순 10,000명 한정 · Redis 기반 고속 처리</p>
      </section>

      {statsError && <FeedbackAlert feedback={statsError} />}

      {stats && (
        <div className={`quota-banner ${isSoldOut ? 'sold-out' : ''}`}>
          <div>
            <strong>잔여 지원금</strong>
            <span className="quota-numbers">
              DB {stats.program.remainingQuota.toLocaleString()} / Redis{' '}
              {stats.redisQuota.toLocaleString()} (총{' '}
              {stats.program.totalQuota.toLocaleString()}명)
            </span>
          </div>
          {isSoldOut && (
            <span className="quota-badge">마감</span>
          )}
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <h2>지원금 신청</h2>
          <form onSubmit={handleApply} className="form">
            <label>
              API 방식
              <select value={mode} onChange={(e) => setMode(e.target.value as ApiMode)}>
                <option value="good">Good — Redis + Redlock (권장)</option>
                <option value="bad">Bad — DB 직행 (비교용)</option>
              </select>
            </label>
            <label>
              사용자 ID
              <div className="input-row">
                <input value={userId} onChange={(e) => setUserId(e.target.value)} required />
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
                pattern="[0-9-]{10,20}"
                title="010으로 시작하는 10~20자리 숫자"
                required
              />
            </label>
            <button
              type="submit"
              className="btn primary"
              disabled={loading || isSoldOut}
            >
              {loading ? '신청 중...' : isSoldOut ? '마감됨' : '신청하기'}
            </button>
          </form>
          <FeedbackAlert feedback={feedback} onClose={() => setFeedback(null)} />
        </section>

        <section className="card">
          <h2>동시 접속 시뮬레이션</h2>
          <p className="hint">
            브라우저에서 동시 요청을 발생시켜 Good/Bad API를 체험합니다. (실제 10만
            부하는 k6 사용)
          </p>
          <div className="form">
            <label>
              동시 요청 수
              <input
                type="number"
                min={10}
                max={2000}
                step={10}
                value={burstCount}
                onChange={(e) => setBurstCount(Number(e.target.value))}
              />
            </label>
            <label>
              API
              <select
                value={burstMode}
                onChange={(e) => setBurstMode(e.target.value as ApiMode)}
              >
                <option value="good">Good API</option>
                <option value="bad">Bad API</option>
              </select>
            </label>
            {burstRunning && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${burstProgress}%` }} />
              </div>
            )}
            <div className="btn-row">
              <button
                type="button"
                className="btn secondary"
                onClick={handleBurst}
                disabled={burstRunning}
              >
                {burstRunning ? '실행 중...' : '시뮬레이션 실행'}
              </button>
              <button
                type="button"
                className="btn outline"
                onClick={handleCompare}
                disabled={burstRunning}
              >
                Good vs Bad 비교
              </button>
            </div>
          </div>

          {burstResult && (
            <div className="stats-grid">
              <Stat label="성공" value={burstResult.success} accent="green" />
              <Stat label="마감" value={burstResult.quotaExhausted} accent="orange" />
              <Stat label="과부하" value={burstResult.tooBusy} />
              <Stat label="중복" value={burstResult.alreadyApplied} />
              <Stat label="오류" value={burstResult.errors} accent="red" />
              <Stat label="소요(ms)" value={burstResult.durationMs} />
            </div>
          )}

          {compareResult && (
            <div className="compare-table">
              <h3>Good vs Bad 비교 결과</h3>
              <table>
                <thead>
                  <tr>
                    <th>지표</th>
                    <th>Good</th>
                    <th>Bad</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>성공</td>
                    <td>{compareResult.good.success}</td>
                    <td>{compareResult.bad.success}</td>
                  </tr>
                  <tr>
                    <td>마감</td>
                    <td>{compareResult.good.quotaExhausted}</td>
                    <td>{compareResult.bad.quotaExhausted}</td>
                  </tr>
                  <tr>
                    <td>과부하</td>
                    <td>{compareResult.good.tooBusy}</td>
                    <td>{compareResult.bad.tooBusy}</td>
                  </tr>
                  <tr>
                    <td>오류</td>
                    <td>{compareResult.good.errors}</td>
                    <td className="bad-cell">{compareResult.bad.errors}</td>
                  </tr>
                  <tr>
                    <td>소요(ms)</td>
                    <td>{compareResult.good.durationMs}</td>
                    <td className="bad-cell">{compareResult.bad.durationMs}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'green' | 'orange' | 'red';
}) {
  return (
    <div className={`stat ${accent ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value.toLocaleString()}</span>
    </div>
  );
}
