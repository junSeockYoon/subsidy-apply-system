export type ApplyFailureReason =
  | 'QUOTA_EXHAUSTED'
  | 'ALREADY_APPLIED'
  | 'TOO_BUSY'
  | 'PROGRAM_NOT_FOUND';

export type ApplyResult =
  | { outcome: 'success'; applicationId: number }
  | { outcome: 'failed'; reason: ApplyFailureReason };

export interface ApplyInput {
  userId: string;
  name: string;
  phone: string;
}
