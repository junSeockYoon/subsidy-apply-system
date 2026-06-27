import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_WORKERS: z.coerce.number().int().positive().default(4),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  SUBSIDY_TOTAL_QUOTA: z.coerce.number().int().positive().default(10000),
  SUBSIDY_PROGRAM_ID: z.coerce.number().int().positive().default(1),

  EXPORT_STORAGE_PATH: z.string().min(1).default('./storage/exports'),
  EXPORT_JOB_CONCURRENCY: z.coerce.number().int().positive().default(2),
});

/**
 * zod로 .env를 서버 기동 시 한 번 검증합니다.
 * 성능 이점: 잘못된 설정으로 Redis/MySQL에 연결 시도하는 비용(타임아웃 대기)을 제거합니다.
 */
export const config = envSchema.parse(process.env);

export type AppConfig = z.infer<typeof envSchema>;
