export type ApplyFailureReason =
  | 'QUOTA_EXHAUSTED'
  | 'ALREADY_APPLIED'
  | 'TOO_BUSY'
  | 'PROGRAM_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export interface UserMessage {
  title: string;
  message: string;
  hint?: string;
  type: 'ok' | 'err' | 'warn' | 'info';
}

const APPLY_REASON_MESSAGES: Record<
  string,
  { title: string; message: string; hint?: string; type: UserMessage['type'] }
> = {
  QUOTA_EXHAUSTED: {
    title: '선착순 마감',
    message: '지원금 1만 명 한도가 모두 소진되었습니다.',
    hint: '관리자 페이지에서 「전체 초기화」 후 다시 테스트할 수 있습니다.',
    type: 'warn',
  },
  ALREADY_APPLIED: {
    title: '중복 신청',
    message: '이미 신청한 사용자 ID입니다.',
    hint: '사용자 ID를 새로 생성하거나 다른 ID로 신청해 주세요.',
    type: 'warn',
  },
  TOO_BUSY: {
    title: '접속 과부하',
    message: '현재 동시 접속이 많아 요청을 처리하지 못했습니다.',
    hint: '잠시 후 다시 시도해 주세요. (Good API 동시 처리 슬롯 50개 제한)',
    type: 'warn',
  },
  PROGRAM_NOT_FOUND: {
    title: '프로그램 없음',
    message: '지원금 프로그램을 찾을 수 없습니다.',
    hint: 'API 서버를 재시작해 기본 프로그램이 생성되었는지 확인하세요.',
    type: 'err',
  },
  VALIDATION_ERROR: {
    title: '입력 오류',
    message: '입력값이 올바르지 않습니다.',
    hint: '이름·전화번호(010으로 시작, 10~20자)를 확인해 주세요.',
    type: 'err',
  },
};

export function mapApplyFailure(
  reason: string | undefined,
  httpStatus: number,
  details?: Record<string, string[] | undefined>,
): UserMessage {
  if (reason && APPLY_REASON_MESSAGES[reason]) {
    const base = APPLY_REASON_MESSAGES[reason];
    let message = base.message;

    if (reason === 'VALIDATION_ERROR' && details) {
      const fieldErrors = Object.entries(details)
        .map(([field, errs]) => `${field}: ${errs?.join(', ')}`)
        .join(' / ');
      if (fieldErrors) message = fieldErrors;
    }

    return { ...base, message };
  }

  if (httpStatus === 503) {
    return APPLY_REASON_MESSAGES.TOO_BUSY;
  }

  if (httpStatus >= 500) {
    return {
      title: '서버 오류',
      message: `서버에서 오류가 발생했습니다. (HTTP ${httpStatus})`,
      hint: 'API 서버 로그를 확인하거나 잠시 후 다시 시도해 주세요.',
      type: 'err',
    };
  }

  return {
    title: '신청 실패',
    message: reason
      ? `알 수 없는 오류: ${reason} (HTTP ${httpStatus})`
      : `요청이 실패했습니다. (HTTP ${httpStatus})`,
    type: 'err',
  };
}

export function mapNetworkError(error: unknown): UserMessage {
  const msg = error instanceof Error ? error.message : '';

  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return {
      title: '서버 연결 실패',
      message: 'API 서버에 연결할 수 없습니다.',
      hint: '터미널에서 npm run dev:api 가 실행 중인지, Docker(MySQL·Redis)가 떠 있는지 확인하세요.',
      type: 'err',
    };
  }

  return {
    title: '오류',
    message: msg || '요청 처리 중 오류가 발생했습니다.',
    type: 'err',
  };
}

export function mapSuccess(applicationId?: number): UserMessage {
  return {
    title: '신청 완료',
    message: `선착순 신청에 성공했습니다! 신청번호: ${applicationId ?? '-'}`,
    type: 'ok',
  };
}

export const EXPORT_STATUS_LABELS: Record<string, string> = {
  waiting: '대기 중 — Worker가 Job을 가져올 때까지 기다립니다',
  active: '생성 중 — MySQL에서 데이터를 읽어 엑셀을 만드는 중입니다',
  completed: '완료 — 다운로드 버튼을 눌러 주세요',
  failed: '실패 — Worker 로그를 확인하세요',
};
