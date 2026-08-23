import { Check, Circle, LoaderCircle, X } from 'lucide-react';
import { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { NodeStatus, TaskNode } from '../../../shared/types';
import { formatUtcInTimeZone } from '../../../shared/time';

const STATUS_META: Record<NodeStatus, { label: string; icon: LucideIcon }> = {
  pending: { label: '待完成', icon: Circle },
  in_progress: { label: '进行中', icon: LoaderCircle },
  completed: { label: '已完成', icon: Check },
  cancelled: { label: '已取消', icon: X }
};

interface TimelineProps {
  nodes: TaskNode[];
  onStatus?: (nodeId: string, status: NodeStatus) => void;
  editable?: boolean;
  hiddenIds?: ReadonlySet<string>;
  tzId?: string;
  highlightedNodeId?: string | null;
}

function formatNodeDates(node: TaskNode, tzId: string): string | null {
  if (!node.startUtc && !node.endUtc) return null;
  const start = formatUtcInTimeZone(node.startUtc, tzId);
  const end = formatUtcInTimeZone(node.endUtc, tzId);
  if (start && end) return start + ' · 到时提醒；截止 ' + end + ' · 仅用于计划';
  if (start) return start + ' · 到时提醒';
  return '截止 ' + end + ' · 仅用于计划';
}

export default function Timeline({ nodes, onStatus, editable = false, hiddenIds = new Set(), tzId = Intl.DateTimeFormat().resolvedOptions().timeZone, highlightedNodeId = null }: TimelineProps): React.JSX.Element {
  const ordered = [...nodes].filter((node) => !hiddenIds.has(node.id)).sort((a, b) => a.position - b.position);
  useEffect(() => {
    if (!highlightedNodeId) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    document.getElementById('timeline-node-' + highlightedNodeId)?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [highlightedNodeId]);
  if (ordered.length === 0) {
    return <p className="timeline-empty">尚未拆分采购节点</p>;
  }

  return (
    <ol className="timeline" aria-label="采购节点">
      {ordered.map((node, index) => {
        const meta = STATUS_META[node.status];
        const StatusIcon = meta.icon;
        const dates = formatNodeDates(node, tzId);
        return (
          <li
            key={node.id}
            id={'timeline-node-' + node.id}
            className={'timeline-item status-' + node.status + (highlightedNodeId === node.id ? ' reminder-highlight' : '')}
          >
            <span className="timeline-axis" aria-hidden="true">
              <span className="timeline-marker"><StatusIcon size={15} strokeWidth={2} /></span>
              {index < ordered.length - 1 && <span className="timeline-connector" />}
            </span>
            <span className="timeline-content">
              <strong>{node.title}</strong>
              {node.description && <span className="timeline-description">{node.description}</span>}
              {dates && <span className="timeline-dates">{dates}</span>}
            </span>
            {editable ? (
              <label className="node-status-control">
                <span className="sr-only">{node.title}的状态</span>
                <select
                  value={node.status}
                  onChange={(event) => onStatus?.(node.id, event.target.value as NodeStatus)}
                >
                  {(Object.keys(STATUS_META) as NodeStatus[]).map((status) => (
                    <option key={status} value={status}>{STATUS_META[status].label}</option>
                  ))}
                </select>
              </label>
            ) : (
              <span className={'timeline-status status-' + node.status}>{meta.label}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
