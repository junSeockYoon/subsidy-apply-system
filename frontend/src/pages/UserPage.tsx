import { useState } from 'react';
import {
  ApiMode,
  applySubsidy,
  BurstResult,
  runBurstSimulation,
} from '../api';

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
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'ok' | 'err' | 'info'>('info');

  const [burstCount, setBurstCount] = useState(100);
  const [burstMode, setBurstMode] = useState<ApiMode>('good');
  const [burstRunning, setBurstRunning] = useState(false);
  const [burstProgress, setBurstProgress] = useState(0);
  const [burstResult, setBurstResult] = useState<BurstResult | null>(null);
  const [compareResult, setCompareResult] = useState<{
    good: BurstResult;
    bad: BurstResult;
  } | null>(null);

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const { status, data } = await applySubsidy(mode, { userId, name, phone });
      if (status === 201) {
        setMessageType('ok');
        setMessage(`선착순 신청 성공! 신청번호: ${data.applicationId}`);
        setUserId(randomUserId());
      } else {
        setMessageType('err');
        setMessage(`신청 실패: ${data.reason ?? 'UNKNOWN'}`);
      }
    } catch {
      setMessageType('err');
      setMessage('서버 연결 실패. API 서버가 실행 중인지 확인하세요.');
    } finally {
      setLoading(false);
    }
  }

  async function handleBurst() {
    setBurstRunning(true);
    setBurstResult(null);
    setBurstProgress(0);
    try {
      const result = await runBurstSimulation(burstMode, burstCount, (done, total) => {
        setBurstProgress(Math.round((done / total) * 100));
      });
      setBurstResult(result);
    } catch {
      setMessageType('err');
      setMessage('부하 시뮬레이션 실패');
    } finally {
      setBurstRunning(false);
    }
  }

  async function handleCompare() {
    setBurstRunning(true);
    setCompareResult(null);
    setMessage('Good API 테스트 중...');
    try {
      const good = await runBurstSimulation('good', burstCount);
      setMessage('Bad API 테스트 중...');
      const bad = await runBurstSimulation('bad', burstCount);
      setCompareResult({ good, bad });
      setMessage(null);
    } catch {
      setMessageType('err');
      setMessage('비교 테스트 실패');
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
              <input value={userId} onChange={(e) => setUserId(e.target.value)} required />
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
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? '신청 중...' : '신청하기'}
            </button>
          </form>
          {message && <div className={`alert ${messageType}`}>{message}</div>}
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
