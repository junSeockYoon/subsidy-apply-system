import { UserMessage } from '../errors';

interface FeedbackAlertProps {
  feedback: UserMessage | null;
  onClose?: () => void;
}

export default function FeedbackAlert({ feedback, onClose }: FeedbackAlertProps) {
  if (!feedback) return null;

  return (
    <div className={`feedback alert-${feedback.type}`} role="alert">
      <div className="feedback-header">
        <strong className="feedback-title">{feedback.title}</strong>
        {onClose && (
          <button type="button" className="feedback-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        )}
      </div>
      <p className="feedback-message">{feedback.message}</p>
      {feedback.hint && <p className="feedback-hint">{feedback.hint}</p>}
    </div>
  );
}
