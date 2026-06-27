import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import fs from 'fs';
import { config } from '../../config';
import {
  enqueueExportJob,
  getExportJobStatus,
  resolveExportFilePath,
} from '../../services/export/export.service';

const router = Router();

const exportRequestSchema = z.object({
  programId: z.coerce.number().int().positive().default(config.SUBSIDY_PROGRAM_ID),
  requestedBy: z.string().min(1).max(64),
});

router.post('/api/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = exportRequestSchema.parse(req.body);
    const { jobId, status } = await enqueueExportJob(body);

    res.status(202).json({
      jobId,
      status,
      message: 'Export job queued',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        status: 'failed',
        reason: 'VALIDATION_ERROR',
        details: error.flatten().fieldErrors,
      });
      return;
    }
    next(error);
  }
});

router.get('/api/export/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = String(req.params.jobId);
    const job = await getExportJobStatus(jobId);

    if (!job) {
      res.status(404).json({ status: 'failed', reason: 'JOB_NOT_FOUND' });
      return;
    }

    res.json(job);
  } catch (error) {
    next(error);
  }
});

router.get(
  '/api/export/:jobId/download',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = String(req.params.jobId);
      const job = await getExportJobStatus(jobId);

      if (!job) {
        res.status(404).json({ status: 'failed', reason: 'JOB_NOT_FOUND' });
        return;
      }

      if (job.status !== 'completed' || !job.result?.fileName) {
        res.status(409).json({
          status: 'failed',
          reason: 'EXPORT_NOT_READY',
          jobStatus: job.status,
        });
        return;
      }

      const absolutePath = resolveExportFilePath(job.result.fileName);

      if (!fs.existsSync(absolutePath)) {
        res.status(404).json({ status: 'failed', reason: 'FILE_NOT_FOUND' });
        return;
      }

      res.download(absolutePath, job.result.fileName);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
