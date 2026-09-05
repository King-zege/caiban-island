import { Cloud, CloudOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FeishuBotStatus } from '../../../shared/types';

export default function FeishuAgentStatusBadge({ compact = false }: { compact?: boolean }): React.JSX.Element | null {
  const [status, setStatus] = useState<FeishuBotStatus | null>(null);

  useEffect(() => {
    let active = true;
    const getStatus = window.api.getFeishuAgentStatus;
    if (typeof getStatus === 'function') {
      void getStatus().then((result) => { if (active && result.ok) setStatus(result.data); });
    }
    const release = typeof window.api.onFeishuAgentChanged === 'function'
      ? window.api.onFeishuAgentChanged((value) => { if (active) setStatus(value); })
      : () => undefined;
    return () => { active = false; release(); };
  }, []);

  if (!status?.configured) return null;
  const connected = status.connectionState === 'connected';
  const label = connected
    ? (compact ? '飞书已连接' : status.botName ?? '飞书已连接')
    : status.connectionState === 'connecting' || status.connectionState === 'reconnecting'
      ? '飞书重连中'
      : '飞书未连接';
  const Icon = connected ? Cloud : CloudOff;
  return <span className={`feishu-agent-badge ${connected ? 'connected' : 'offline'}`} role="status" title={`飞书机器人：${label}`}><Icon aria-hidden="true" size={15} /><span>{label}</span></span>;
}
