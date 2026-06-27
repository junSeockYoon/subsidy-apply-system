/**
 * k6 부하 테스트 — DB 직행 Bad API (비교용)
 *
 * 실행:
 *   npm run loadtest:bad:smoke
 *   K6_PROFILE=standard npm run loadtest:bad
 *   K6_PROFILE=stress npm run loadtest:bad
 */
import { buildOptions, runApply, buildSummaryHandler } from './lib.js';

export const options = buildOptions('bad');

export default function () {
  runApply('/api/apply/bad');
}

export const handleSummary = buildSummaryHandler('summary-bad.json');
