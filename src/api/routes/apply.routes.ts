import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { applyGood } from '../../services/apply/apply.good.service';
import { applyBad } from '../../services/apply/apply.bad.service';
import { ApplyResult } from '../../services/apply/types';

const router = Router();

const applySchema = z.object({
  userId: z.string().min(1).max(64),
  name: z.string().min(1).max(50),
  phone: z.string().regex(/^[0-9-]{10,20}$/, 'Invalid phone format'),
});

function sendApplyResponse(res: Response, result: ApplyResult): void {
  if (result.outcome === 'success') {
    res.status(201).json({
      status: 'success',
      applicationId: result.applicationId,
    });
    return;
  }

  const statusMap = {
    QUOTA_EXHAUSTED: 409,
    ALREADY_APPLIED: 409,
    TOO_BUSY: 503,
    PROGRAM_NOT_FOUND: 404,
  } as const;

  res.status(statusMap[result.reason]).json({
    status: 'failed',
    reason: result.reason,
  });
}

async function handleApply(
  req: Request,
  res: Response,
  next: NextFunction,
  handler: typeof applyGood,
): Promise<void> {
  try {
    const body = applySchema.parse(req.body);
    const result = await handler(body, config.SUBSIDY_PROGRAM_ID);
    sendApplyResponse(res, result);
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
}

router.post('/api/apply/good', (req, res, next) => {
  void handleApply(req, res, next, applyGood);
});

router.post('/api/apply/bad', (req, res, next) => {
  void handleApply(req, res, next, applyBad);
});

export default router;
