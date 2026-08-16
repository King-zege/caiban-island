import { AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from './Button';

export function AsyncFeedback({ tone, message, onRetry }: { tone: 'success' | 'error'; message: string; onRetry?: () => void }): React.JSX.Element {
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div className={'async-feedback ' + tone} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" size={18} />
      <span>{message}</span>
      {onRetry && <Button icon={RotateCcw} variant="ghost" onClick={onRetry}>重试</Button>}
    </div>
  );
}
