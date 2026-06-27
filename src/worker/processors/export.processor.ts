import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import mysql from 'mysql2';
import ExcelJS from 'exceljs';
import { Job } from 'bullmq';
import { config } from '../../config';
import { ExportJobPayload, ExportJobResult } from '../../types';
import { ensureExportStorageDir } from '../../services/export/export.service';
import { logger } from '../../lib/logger';

type WorkbookWriter = {
  addWorksheet: (name: string) => WorksheetWriter;
  commit: () => Promise<void>;
};

type WorksheetWriter = {
  columns: Array<{ header: string; key: string; width?: number }>;
  addRow: (values: Record<string, unknown>) => { commit: () => void };
};

type ExcelStreamModule = {
  stream: {
    xlsx: {
      WorkbookWriter: new (options: {
        filename: string;
        useSharedStrings?: boolean;
      }) => WorkbookWriter;
    };
  };
};

const ExcelStream = ExcelJS as typeof ExcelJS & ExcelStreamModule;

function createMysqlConnection() {
  return mysql.createConnection({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
  });
}

interface ApplicationRow {
  id: number;
  program_id: number;
  user_id: string;
  name: string;
  phone: string;
  status: string;
  created_at: Date;
}

/**
 * MySQL Stream → ExcelJS StreamWriter 파이프라인
 *
 * 성능 이점:
 * - mysql2 .stream(): 행 단위로 읽어 수십만 건도 메모리 사용량 일정
 * - WorkbookWriter: 디스크에 스트리밍 쓰기 → OOM 방지
 * - useSharedStrings: false — 대용량 export 시 메모리 절약
 */
export async function processExportJob(
  job: Job<ExportJobPayload, ExportJobResult>,
): Promise<ExportJobResult> {
  const { programId, requestedBy } = job.data;
  const storageDir = await ensureExportStorageDir();
  const fileName = `export-${programId}-${job.id}.xlsx`;
  const filePath = path.join(storageDir, fileName);

  logger.info({ jobId: job.id, programId, requestedBy }, 'Export job started');

  const connection = createMysqlConnection();

  const sql = `
    SELECT id, program_id, user_id, name, phone, status, created_at
    FROM applications
    WHERE program_id = ?
    ORDER BY id ASC
  `;

  const rowStream = connection.query(sql, [programId]).stream({
    highWaterMark: 100,
  }) as NodeJS.ReadableStream;

  const workbook = new ExcelStream.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useSharedStrings: false,
  });

  const worksheet = workbook.addWorksheet('신청내역') as WorksheetWriter;
  worksheet.columns = [
    { header: 'ID', key: 'id', width: 12 },
    { header: '프로그램ID', key: 'program_id', width: 12 },
    { header: '사용자ID', key: 'user_id', width: 20 },
    { header: '이름', key: 'name', width: 15 },
    { header: '전화번호', key: 'phone', width: 15 },
    { header: '상태', key: 'status', width: 10 },
    { header: '신청일시', key: 'created_at', width: 22 },
  ];

  let rowCount = 0;
  let lastProgressUpdate = 0;

  const excelTransform = new Transform({
    objectMode: true,
    transform(row: ApplicationRow, _encoding, callback) {
      try {
        worksheet
          .addRow({
            id: row.id,
            program_id: row.program_id,
            user_id: row.user_id,
            name: row.name,
            phone: row.phone,
            status: row.status,
            created_at: row.created_at,
          })
          .commit();

        rowCount += 1;

        if (rowCount - lastProgressUpdate >= 5000) {
          lastProgressUpdate = rowCount;
          void job.updateProgress(rowCount);
        }

        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });

  try {
    await pipeline(rowStream, excelTransform);
    await workbook.commit();

    logger.info({ jobId: job.id, rowCount, filePath }, 'Export job completed');

    return { fileName, filePath, rowCount };
  } catch (error) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  } finally {
    connection.end();
  }
}
