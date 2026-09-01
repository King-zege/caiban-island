import { CalendarClock, CircleDollarSign, FileCheck2, TriangleAlert } from 'lucide-react';
import type { ContractCard as ContractCardValue } from '../../../shared/contractContracts';
import { CONTRACT_ACTION_LABELS, CONTRACT_STATUS_LABELS } from '../../../shared/contractContracts';

function dueLabel(value: string | null, tzId: string): string {
  if (!value) return '未设时间';
  try { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tzId }).format(new Date(value)); }
  catch { return value.slice(0, 16).replace('T', ' '); }
}

export default function ContractCard({ card, tabIndex, onOpen, onFocus }: { card: ContractCardValue; tabIndex: number; onOpen: () => void; onFocus: () => void }): React.JSX.Element {
  const { contract, nextAction, risk } = card;
  const supplierLabel = contract.supplierName || '供应商待补充';
  const RiskIcon = risk === 'overdue' || risk === 'due_soon' ? TriangleAlert : nextAction?.type === 'payment' || nextAction?.type === 'invoice' ? CircleDollarSign : FileCheck2;
  return <button type="button" className={`contract-card risk-${risk}`} data-contract-id={contract.id} tabIndex={tabIndex} onFocus={onFocus} onClick={onOpen}
    aria-label={`${contract.shortName}，供应商 ${contract.supplierName || '待补充'}，${nextAction ? `下一动作 ${nextAction.title}` : '暂无待办动作'}`}>
    <span className="contract-card-rail" aria-hidden="true" />
    <span className="contract-card-top"><small>{CONTRACT_STATUS_LABELS[contract.status]}</small><span>{contract.contractNo || '未编号'}</span></span>
    <strong className="contract-card-title">{contract.shortName}</strong>
    <span className="contract-card-supplier">{supplierLabel}</span>
    <span className="contract-card-next"><RiskIcon aria-hidden="true" size={17} /><span><small>{nextAction ? CONTRACT_ACTION_LABELS[nextAction.type] : '履约状态'}</small><strong>{nextAction?.title ?? '暂无待办动作'}</strong></span></span>
    <span className="contract-card-foot"><CalendarClock aria-hidden="true" size={14} />{nextAction ? dueLabel(nextAction.dueAtUtc, contract.tzId) : `${card.pendingActionCount} 项待办`}</span>
  </button>;
}
