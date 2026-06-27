/**
 * k6 부하 테스트 — Redis + Redlock Good API
 *
 * 실행:
 *   npm run loadtest:good:smoke
 *   K6_PROFILE=standard npm run loadtest:good
 *   K6_PROFILE=stress npm run loadtest:good
 */
import { buildOptions, runApply, buildSummaryHandler } from './lib.js';

export const options = buildOptions('good');

export default function () {
  runApply('/api/apply/good');
}

export const handleSummary = buildSummaryHandler('summary-good.json');
