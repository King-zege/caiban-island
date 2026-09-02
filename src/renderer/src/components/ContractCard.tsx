import { CalendarClock, CircleDollarSign, FileCheck2, Link2, Paperclip, TriangleAlert } from 'lucide-react';
import type { ContractCard as ContractCardValue } from '../../../shared/contractContracts';
import { CONTRACT_ACTION_LABELS, CONTRACT_STATUS_LABELS } from '../../../shared/contractContracts';

function dueLabel(value: string | null, tzId: string): string {
  if (!value) return '未设时间';
  try { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tzId }).format(new Date(value)); }
  catch { return value.slice(0, 16).replace('T', ' '); }
}

function amountLabel(value: number | null, currency: string): string {
  if (value === null) return '金额待补充';
  try {
    const digits = new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 2 }).format(value / 10 ** digits);
  } catch { return `${currency} ${value}`; }
}

export default function ContractCard({ card, tabIndex, onOpen, onFocus }: { card: ContractCardValue; tabIndex: number; onOpen: () => void; onFocus: () => void }): React.JSX.Element {
  const { contract, nextAction, risk } = card;
  const supplierLabel = contract.supplierName || '供应商待补充';
  const RiskIcon = risk === 'overdue' || risk === 'due_soon' ? TriangleAlert : nextAction?.type === 'payment' || nextAction?.type === 'invoice' ? CircleDollarSign : FileCheck2;
  const amount = amountLabel(contract.amountMinor, contract.currency);
  return <button type="button" className={`contract-card risk-${risk}`} data-contract-id={contract.id} tabIndex={tabIndex} onFocus={onFocus} onClick={onOpen}
    aria-label={`${contract.shortName}，合同编号 ${contract.contractNo || '待补充'}，供应商 ${contract.supplierName || '待补充'}，合同金额 ${amount}，${card.fileCount} 份附件，${card.urlCount} 个附属链接，${nextAction ? `下一节点 ${nextAction.title}` : '暂无待办节点'}`}>
    <span className="contract-card-rail" aria-hidden="true" />
    <span className="contract-card-top"><small>{CONTRACT_STATUS_LABELS[contract.status]}</small><span>{contract.contractNo || '未编号'}</span></span>
    <strong className="contract-card-title">{contract.shortName}</strong>
    <span className="contract-card-facts"><span className="contract-card-supplier">{supplierLabel}</span><strong>{amount}</strong></span>
    <span className="contract-card-next"><RiskIcon aria-hidden="true" size={17} /><span><small>{nextAction ? CONTRACT_ACTION_LABELS[nextAction.type] : '合同节点'}</small><strong>{nextAction?.title ?? '暂无待办节点'}</strong></span></span>
    <span className="contract-card-foot"><span><CalendarClock aria-hidden="true" size={14} />{nextAction ? dueLabel(nextAction.dueAtUtc, contract.tzId) : `${card.pendingActionCount} 项待办`}</span><span className={`contract-card-material ${card.fileCount === 0 ? 'material-missing' : ''}`} title={card.primaryFile?.title ?? '尚未添加合同扫描件'}><Paperclip aria-hidden="true" size={13} />{card.primaryFile ? `${card.primaryFile.title}${card.fileCount > 1 ? ` +${card.fileCount - 1}` : ''}` : '缺扫描件'}</span><span title={`${card.urlCount} 个附属链接`}><Link2 aria-hidden="true" size={13} />{card.urlCount}</span></span>
  </button>;
}
