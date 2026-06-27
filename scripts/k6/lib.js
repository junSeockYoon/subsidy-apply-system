import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/v0.1.0/index.js';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

/** 커스텀 메트릭 — good/bad API 성능·정합성 비교용 */
export const applySuccess = new Counter('apply_success');
export const applyQuotaExhausted = new Counter('apply_quota_exhausted');
export const applyTooBusy = new Counter('apply_too_busy');
export const applyAlreadyApplied = new Counter('apply_already_applied');
export const applyHttpErrors = new Counter('apply_http_errors');

/**
 * K6_PROFILE 환경변수로 부하 시나리오 선택
 * - smoke: 로컬 빠른 검증 (~100 VU)
 * - standard: 중간 부하 (~5,000 VU)
 * - stress: 목표 시나리오 (~100,000 VU, 고사양/클라우드 권장)
 */
const PROFILES = {
  smoke: {
    stages: [
      { duration: '10s', target: 50 },
      { duration: '20s', target: 100 },
      { duration: '10s', target: 0 },
    ],
  },
  standard: {
    stages: [
      { duration: '30s', target: 500 },
      { duration: '1m', target: 2000 },
      { duration: '1m', target: 5000 },
      { duration: '30s', target: 0 },
    ],
  },
  stress: {
    stages: [
      { duration: '30s', target: 1000 },
      { duration: '1m', target: 10000 },
      { duration: '2m', target: 50000 },
      { duration: '2m', target: 100000 },
      { duration: '1m', target: 0 },
    ],
  },
};

export function buildOptions(label) {
  const profile = __ENV.K6_PROFILE || 'smoke';
  const stages = PROFILES[profile] ? PROFILES[profile].stages : PROFILES.smoke.stages;

  return {
    scenarios: {
      [`apply_${label}`]: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages,
        gracefulRampDown: '10s',
      },
    },
    thresholds: {
      http_req_failed: ['rate<0.99'],
      http_req_duration: ['p(95)<10000'],
    },
  };
}

/**
 * 선착순 신청 1회 실행
 * userId를 VU·ITER·타임스탬프 조합으로 유니크하게 생성해 중복 신청 방지
 */
export function runApply(endpoint) {
  const userId = `k6-${endpoint.replace(/\//g, '')}-${__VU}-${__ITER}-${Date.now()}`;
  const phoneNum = 10000000 + ((__VU * 100000 + __ITER) % 89999999);
  const payload = JSON.stringify({
    userId,
    name: `k6u${__VU}`,
    phone: `010${String(phoneNum).padStart(8, '0')}`,
  });

  const res = http.post(`${BASE_URL}${endpoint}`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint },
    timeout: '30s',
  });

  if (res.status === 201) {
    applySuccess.add(1);
  } else if (res.status === 409) {
    try {
      const body = JSON.parse(res.body);
      if (body.reason === 'QUOTA_EXHAUSTED') {
        applyQuotaExhausted.add(1);
      } else if (body.reason === 'ALREADY_APPLIED') {
        applyAlreadyApplied.add(1);
      } else {
        applyHttpErrors.add(1);
      }
    } catch {
      applyHttpErrors.add(1);
    }
  } else if (res.status === 503) {
    applyTooBusy.add(1);
  } else {
    applyHttpErrors.add(1);
  }

  return res;
}

export function buildSummaryHandler(resultFileName) {
  return function handleSummary(data) {
    const output = {
      stdout: textSummary(data, { indent: ' ', enableColors: true }),
    };
    output[`scripts/k6/results/${resultFileName}`] = JSON.stringify(data, null, 2);
    return output;
  };
}
