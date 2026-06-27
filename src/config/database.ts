import { Sequelize } from 'sequelize';
import { config } from './index';

/**
 * Sequelize 커넥션 풀 설정
 *
 * 성능 이점:
 * - pool.max: 요청마다 TCP 연결을 새로 맺지 않고 기존 연결을 재사용합니다.
 * - pool.min: 트래픽 급증 시 연결 생성 지연(cold start)을 줄입니다.
 * - idle: 유휴 연결을 정리해 MySQL max_connections 고갈을 방지합니다.
 */
export const sequelize = new Sequelize(config.DB_NAME, config.DB_USER, config.DB_PASSWORD, {
  host: config.DB_HOST,
  port: config.DB_PORT,
  dialect: 'mysql',
  logging: config.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: config.DB_POOL_MAX,
    min: 2,
    acquire: 30000,
    idle: 10000,
  },
  define: {
    underscored: true,
    timestamps: true,
  },
});

export async function connectDatabase(): Promise<void> {
  await sequelize.authenticate();
}

export async function closeDatabase(): Promise<void> {
  await sequelize.close();
}
