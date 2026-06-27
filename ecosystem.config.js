/**
 * PM2 멀티 프로세스 설정
 *
 * 성능 최적화 포인트:
 * - API 서버: cluster 모드로 CPU 코어 수만큼 인스턴스 실행 → 싱글 스레드 한계 극복
 * - Worker: fork 모드 단일/소수 인스턴스 → 메모리 집약적 엑셀 생성 시 OOM 방지
 * - max_memory_restart: 메모리 누수 시 자동 재시작으로 서비스 안정성 확보
 */
module.exports = {
  apps: [
    {
      name: 'subsidy-api',
      script: 'dist/api/server.js',
      instances: Number(process.env.API_WORKERS) || 4,
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'subsidy-worker',
      script: 'dist/worker/worker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
