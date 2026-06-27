import { Worker } from 'bullmq';
import { config } from '../config';
import { connectDatabase, closeDatabase } from '../config/database';
import { EXPORT_QUEUE_NAME, getBullmqConnection } from '../config/bullmq';
import { processExportJob } from './processors/export.processor';
import { logger } from '../lib/logger';

/**
 * BullMQ Worker 프로세스
 *
 * 성능 이점:
 * - API와 분리된 프로세스에서 엑셀 생성 → 이벤트 루프·메모리 격리
 * - concurrency 제한으로 OOM 방지 (EXPORT_JOB_CONCURRENCY)
 */
async function bootstrap(): Promise<void> {
  await connectDatabase();

  const worker = new Worker(EXPORT_QUEUE_NAME, processExportJob, {
    connection: getBullmqConnection(),
    concurrency: config.EXPORT_JOB_CONCURRENCY,
  });

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, rowCount: job.returnvalue?.rowCount },
      'Export worker job completed',
    );
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, err: error }, 'Export worker job failed');
  });

  logger.info(
    { queue: EXPORT_QUEUE_NAME, concurrency: config.EXPORT_JOB_CONCURRENCY },
    'Export worker started',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down export worker');
    await worker.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'Failed to start export worker');
  process.exit(1);
});
