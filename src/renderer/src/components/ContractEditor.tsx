import { Bell, Check, File, Link2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ContractAction, ContractActionInput, ContractActionType, ContractDetail, ContractWorkspaceSection } from '../../../shared/contractContracts';
import { CONTRACT_ACTION_LABELS, CONTRACT_ACTION_STATUS_LABELS, CONTRACT_STATUS_LABELS } from '../../../shared/contractContracts';
import { useContractStore } from '../state/useContractStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import MarkdownNote from './MarkdownNote';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { EmptyState } from './ui/EmptyState';
import { ExternalTargetDialog } from './ui/ExternalTargetDialog';
import type { ExternalTarget } from './ui/ExternalTargetDialog';
import { Field } from './ui/Field';

function money(value: number | null, currency: string): string {
  if (value === null) return '未填写';
  const digits = new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(value / 10 ** digits);
}

function majorAmount(value: number | null, currency: string): string {
  if (value === null) return '';
  const digits = new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return (value / 10 ** digits).toFixed(digits);
}

function minorAmount(value: string, currency: string): number | null {
  if (!value.trim()) return null;
  const digits = new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(value.trim())) throw new Error(`金额最多保留 ${digits} 位小数`);
  const [whole, fraction = ''] = value.trim().split('.');
  const result = BigInt(whole) * BigInt(10 ** digits) + BigInt(fraction.padEnd(digits, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额超出可保存范围');
  return Number(result);
}

function date(value: string | null): string { return value || '未填写'; }
function localInput(value: string | null): string { if (!value) return ''; const d = new Date(value); const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }

export default function ContractEditor({ detail, section }: { detail: ContractDetail; section: ContractWorkspaceSection }): React.JSX.Element {
  const { contract, actions, links, reminders } = detail;
  const addAction = useContractStore((state) => state.addAction); const setActionStatus = useContractStore((state) => state.setActionStatus);
  const removeAction = useContractStore((state) => state.removeAction); const setActionReminder = useContractStore((state) => state.setActionReminder);
  const setStatus = useContractStore((state) => state.setStatus); const addLink = useContractStore((state) => state.addLink); const removeLink = useContractStore((state) => state.removeLink);
  const updateContract = useContractStore((state) => state.updateContract);
  const saveNote = useContractStore((state) => state.saveNote); const notify = useWorkspaceStore((state) => state.notify);
  const setContractSection = useWorkspaceStore((state) => state.setContractSection);
  const [actionType, setActionType] = useState<ContractActionType>('payment'); const [actionTitle, setActionTitle] = useState('');
  const [dueText, setDueText] = useState(''); const [actionAmount, setActionAmount] = useState(''); const [relatedActionId, setRelatedActionId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null); const [reminderAction, setReminderAction] = useState<ContractAction | null>(null);
  const [reminderText, setReminderText] = useState(''); const [reminderError, setReminderError] = useState<string | null>(null);
  const [fileTitle, setFileTitle] = useState('合同扫描件'); const [fileTarget, setFileTarget] = useState(''); const [fileError, setFileError] = useState<string | null>(null);
  const [urlTitle, setUrlTitle] = useState(''); const [urlTarget, setUrlTarget] = useState(''); const [urlError, setUrlError] = useState<string | null>(null);
  const [note, setNote] = useState(detail.note); const [externalTarget, setExternalTarget] = useState<ExternalTarget | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<'active' | 'closing' | 'closed' | 'terminated' | 'archived' | null>(null);
  const [fullName, setFullName] = useState(contract.fullName); const [shortName, setShortName] = useState(contract.shortName);
  const [supplierName, setSupplierName] = useState(contract.supplierName); const [contractNo, setContractNo] = useState(contract.contractNo);
  const [currency, setCurrency] = useState(contract.currency); const [amount, setAmount] = useState(() => majorAmount(contract.amountMinor, contract.currency));
  const [signedOn, setSignedOn] = useState(contract.signedOn ?? ''); const [effectiveOn, setEffectiveOn] = useState(contract.effectiveOn ?? ''); const [expiresOn, setExpiresOn] = useState(contract.expiresOn ?? '');
  const [ledgerError, setLedgerError] = useState<string | null>(null); const [ledgerSaving, setLedgerSaving] = useState(false);

  useEffect(() => {
    setFullName(contract.fullName); setShortName(contract.shortName); setSupplierName(contract.supplierName); setContractNo(contract.contractNo);
    setCurrency(contract.currency); setAmount(majorAmount(contract.amountMinor, contract.currency)); setSignedOn(contract.signedOn ?? '');
    setEffectiveOn(contract.effectiveOn ?? ''); setExpiresOn(contract.expiresOn ?? ''); setNote(detail.note); setLedgerError(null);
  }, [contract.id, contract.updatedAtUtc, contract.amountMinor, contract.contractNo, contract.currency, contract.effectiveOn, contract.expiresOn, contract.fullName, contract.shortName, contract.signedOn, contract.supplierName, detail.note]);

  const saveLedger = async () => {
    setLedgerError(null); setLedgerSaving(true);
    let amountMinor: number | null;
    try { amountMinor = minorAmount(amount, currency); } catch (reason) { setLedgerSaving(false); setLedgerError(reason instanceof Error ? reason.message : String(reason)); return; }
    const error = await updateContract({
      contractId: contract.id, procurementProjectId: contract.procurementProjectId, fullName, shortName, contractNo, supplierName,
      amountMinor, currency, signedOn: signedOn || null, effectiveOn: effectiveOn || null, expiresOn: expiresOn || null,
      tzId: contract.tzId, expectedUpdatedAtUtc: contract.updatedAtUtc
    });
    setLedgerSaving(false); setLedgerError(error); notify(error ?? '合同台账已更新', error ? 'error' : 'success');
  };

  const filteredActions = useMemo(() => {
    if (section === 'billing') return actions.filter((action) => action.type === 'payment' || action.type === 'invoice');
    if (section === 'acceptance') return actions.filter((action) => action.type === 'delivery' || action.type === 'acceptance');
    return actions;
  }, [actions, section]);

  const createAction = async () => {
    setActionError(null);
    let amountMinor: number | null = null;
    if (actionAmount.trim()) {
      if (!/^\d+$/.test(actionAmount.trim())) { setActionError('动作金额请填写整数最小货币单位'); return; }
      amountMinor = Number(actionAmount);
    }
    const input: ContractActionInput = { type: actionType, title: actionTitle, description: '', dueAtUtc: dueText ? new Date(dueText).toISOString() : null, amountMinor, relatedActionId: relatedActionId || null };
    const error = await addAction(contract.id, input);
    if (error) { setActionError(error); return; }
    setActionTitle(''); setDueText(''); setActionAmount(''); setRelatedActionId(''); notify('合同节点已添加', 'success');
  };

  const saveReminder = async () => {
    if (!reminderAction) return;
    const current = reminders.find((item) => item.actionId === reminderAction.id)?.fireAtUtc ?? null;
    const fireAtUtc = reminderText ? new Date(reminderText).toISOString() : null;
    const error = await setActionReminder({ actionId: reminderAction.id, fireAtUtc, expectedFireAtUtc: current });
    if (error) { setReminderError(error); return; }
    setReminderAction(null); notify(fireAtUtc ? '节点提醒已设置' : '节点提醒已清除', 'success');
  };

  const addMaterial = async (kind: 'file' | 'url') => {
    const target = kind === 'file' ? fileTarget : urlTarget;
    const title = kind === 'file' ? fileTitle : urlTitle;
    if (kind === 'file') setFileError(null); else setUrlError(null);
    const error = await addLink(contract.id, { kind, title, target });
    if (kind === 'file') {
      setFileError(error);
      if (!error) { setFileTarget(''); setFileTitle('合同扫描件'); }
    } else {
      setUrlError(error);
      if (!error) { setUrlTarget(''); setUrlTitle(''); }
    }
    if (!error) notify(kind === 'file' ? '合同扫描件或附件已添加' : '合同附属链接已添加', 'success');
  };

  const fileLinks = links.filter((link) => link.kind === 'file');
  const urlLinks = links.filter((link) => link.kind === 'url');
  const primaryFile = fileLinks[0] ?? null;

  if (section === 'overview') return <div className="contract-workspace-section">
    <div className="contract-overview-hero"><div><h2>{contract.fullName}</h2><p>{contract.shortName} · {CONTRACT_STATUS_LABELS[contract.status]}</p></div><strong>{money(contract.amountMinor, contract.currency)}</strong></div>
    <dl className="contract-ledger-grid contract-core-grid"><div><dt>合同编号</dt><dd>{contract.contractNo || '待补充'}</dd></div><div><dt>供应商</dt><dd>{contract.supplierName || '待补充'}</dd></div><div><dt>合同扫描件</dt><dd>{primaryFile ? <button className="contract-record-link" title={primaryFile.target} onClick={() => setExternalTarget({ kind: 'file', target: primaryFile.target, title: primaryFile.title })}>{primaryFile.title}</button> : <button className="contract-record-link missing" onClick={() => setContractSection('materials')}>缺少，立即添加</button>}</dd></div><div><dt>附属资料</dt><dd><button className="contract-record-link" onClick={() => setContractSection('materials')}>{fileLinks.length} 份附件 · {urlLinks.length} 个链接</button></dd></div></dl>
    <dl className="contract-ledger-grid"><div><dt>签署日期</dt><dd>{date(contract.signedOn)}</dd></div><div><dt>生效日期</dt><dd>{date(contract.effectiveOn)}</dd></div><div><dt>到期日期</dt><dd>{date(contract.expiresOn)}</dd></div><div><dt>待办节点</dt><dd>{actions.filter((action) => action.status === 'pending' || action.status === 'in_progress').length}</dd></div></dl>
    <section className="workspace-block contract-ledger-editor"><div className="section-heading"><div><span className="eyebrow">正式信息</span><h3>维护合同台账</h3></div></div><div className="contract-ledger-form">
      <Field label="合同正式全名" value={fullName} maxLength={500} onChange={(event) => setFullName(event.target.value)} />
      <Field label="卡片简称" value={shortName} maxLength={24} onChange={(event) => setShortName(event.target.value)} />
      <Field label="供应商" value={supplierName} maxLength={300} onChange={(event) => setSupplierName(event.target.value)} />
      <Field label="合同号" value={contractNo} maxLength={100} onChange={(event) => setContractNo(event.target.value)} />
      <Field label={`合同金额（${currency}）`} value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} />
      <Field label="币种" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
      <Field label="签署日期" type="date" value={signedOn} onChange={(event) => setSignedOn(event.target.value)} />
      <Field label="生效日期" type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} />
      <Field label="到期日期" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
    </div><div className="contract-ledger-save"><Button variant="primary" disabled={ledgerSaving || (!fullName.trim() && !shortName.trim())} onClick={() => void saveLedger()}>{ledgerSaving ? '正在保存' : '保存台账'}</Button>{ledgerError && <AsyncFeedback tone="error" message={ledgerError} onRetry={() => void saveLedger()} />}</div></section>
    <section className="workspace-block"><div className="section-heading"><div><span className="eyebrow">生命周期</span><h3>合同状态控制</h3></div></div><div className="row-actions">
      {contract.status === 'draft' && <Button variant="primary" onClick={() => setLifecycleTarget('active')}>启用合同</Button>}
      {contract.status === 'active' && <Button onClick={() => setLifecycleTarget('closing')}>进入收尾</Button>}
      {(contract.status === 'active' || contract.status === 'closing') && <Button onClick={() => setLifecycleTarget('closed')}>关闭合同</Button>}
      {contract.status !== 'archived' && <Button variant="ghost" onClick={() => setLifecycleTarget('archived')}>归档</Button>}{contract.status !== 'terminated' && <Button variant="danger" onClick={() => setLifecycleTarget('terminated')}>终止</Button>}
    </div></section>
    <Dialog open={lifecycleTarget !== null} title="确认变更合同状态？" description="关闭、终止或归档后将停止未触发的履约提醒。" onClose={() => setLifecycleTarget(null)} actions={<><Button variant="ghost" onClick={() => setLifecycleTarget(null)}>取消</Button><Button variant={lifecycleTarget === 'terminated' ? 'danger' : 'primary'} onClick={() => { if (!lifecycleTarget) return; void setStatus({ contractId: contract.id, status: lifecycleTarget, expectedStatus: contract.status }).then((error) => { notify(error ?? '合同状态已更新', error ? 'error' : 'success'); if (!error) setLifecycleTarget(null); }); }}>确认变更</Button></>}><p>{contract.shortName}：{CONTRACT_STATUS_LABELS[contract.status]} → {lifecycleTarget ? CONTRACT_STATUS_LABELS[lifecycleTarget] : ''}</p></Dialog>
    <ExternalTargetDialog target={externalTarget} onClose={() => setExternalTarget(null)} />
  </div>;

  if (section === 'materials') return <div className="contract-workspace-section contract-materials-workspace">
    <div className="section-heading"><div><h2>合同扫描件、附件与附属链接</h2><p>文件只记录本机绝对路径；采办岛不会复制或上传原文件。</p></div><span>{fileLinks.length + urlLinks.length} 项</span></div>
    <section className="contract-material-group" aria-labelledby="contract-files-title"><div className="section-heading"><div><h3 id="contract-files-title">合同扫描件与附件</h3><p>建议至少保存一份签署扫描件，也可以继续添加验收单、发票或补充协议。</p></div></div>
      {fileLinks.length === 0 ? <EmptyState icon={File} title="尚未添加合同扫描件" description="填写本机磁盘绝对路径，例如 C:\采购项目\合同扫描件.pdf。" /> : <ul className="material-list">{fileLinks.map((link) => <li key={link.id}><File aria-hidden="true" size={18} /><button className="material-link" title={link.target} onClick={() => setExternalTarget({ kind: 'file', target: link.target, title: link.title })}><strong>{link.title}</strong><span>{link.target}</span></button><IconButton icon={Trash2} label={`删除附件${link.title}`} variant="danger" onClick={() => void removeLink(link.id).then((error) => notify(error ?? '合同附件已删除', error ? 'error' : 'success'))} /></li>)}</ul>}
      <div className="material-composer contract-material-composer"><Field label="文件绝对路径" aria-label="合同附件绝对路径" value={fileTarget} maxLength={2048} error={fileError} placeholder="C:\采购项目\合同扫描件.pdf" onChange={(event) => setFileTarget(event.target.value)} /><Field label="文件名称" value={fileTitle} maxLength={200} placeholder="合同扫描件" onChange={(event) => setFileTitle(event.target.value)} /><Button icon={Plus} variant="primary" disabled={!fileTarget.trim()} onClick={() => void addMaterial('file')}>添加附件</Button></div>
    </section>
    <section className="contract-material-group" aria-labelledby="contract-urls-title"><div className="section-heading"><div><h3 id="contract-urls-title">附属链接</h3><p>用于电子合同平台、供应商系统或其他与合同相关的网址。</p></div></div>
      {urlLinks.length === 0 ? <EmptyState icon={Link2} title="尚未添加附属链接" description="可添加电子签章、供应商或项目系统的 http/https 地址。" /> : <ul className="material-list">{urlLinks.map((link) => <li key={link.id}><Link2 aria-hidden="true" size={18} /><button className="material-link" title={link.target} onClick={() => setExternalTarget({ kind: 'url', target: link.target, title: link.title })}><strong>{link.title}</strong><span>{link.target}</span></button><IconButton icon={Trash2} label={`删除链接${link.title}`} variant="danger" onClick={() => void removeLink(link.id).then((error) => notify(error ?? '附属链接已删除', error ? 'error' : 'success'))} /></li>)}</ul>}
      <div className="material-composer contract-material-composer"><Field label="链接地址" value={urlTarget} maxLength={2048} inputMode="url" error={urlError} placeholder="https://..." onChange={(event) => setUrlTarget(event.target.value)} /><Field label="链接名称" value={urlTitle} maxLength={200} placeholder="例如：电子合同平台" onChange={(event) => setUrlTitle(event.target.value)} /><Button icon={Plus} variant="primary" disabled={!urlTarget.trim()} onClick={() => void addMaterial('url')}>添加链接</Button></div>
    </section>
    <ExternalTargetDialog target={externalTarget} onClose={() => setExternalTarget(null)} />
  </div>;

  if (section === 'notes') return <div className="contract-workspace-section"><div className="section-heading"><div><span className="eyebrow">合同备注</span><h2>决策、沟通与变更记录</h2></div></div><MarkdownNote body={note} onChange={setNote} onOpenExternal={(target) => setExternalTarget({ kind: 'url', target, title: '备注中的链接' })} /><div className="note-actions"><Button variant="primary" onClick={() => void saveNote(contract.id, note).then((error) => notify(error ?? '合同备注已保存', error ? 'error' : 'success'))}>保存备注</Button></div><ExternalTargetDialog target={externalTarget} onClose={() => setExternalTarget(null)} /></div>;

  return <div className="contract-workspace-section"><div className="section-heading"><div><span className="eyebrow">{section === 'billing' ? '付款开票节点' : section === 'acceptance' ? '交付验收节点' : '合同节点'}</span><h2>管理合同节点与提醒</h2><p>可持续添加多个节点，并为每个节点设置独立的计划时间和提醒。</p></div><span>{filteredActions.length} 个节点</span></div>
    {filteredActions.length === 0 ? <EmptyState icon={Check} title="这个分区还没有合同节点" description="新增付款、开票、交付、验收、续签或归档节点；每个节点都可以单独提醒。" /> : <ul className="contract-action-list">{filteredActions.map((action) => {
      const reminder = reminders.find((item) => item.actionId === action.id);
      return <li key={action.id} className={`status-${action.status}`}><span className="contract-action-icon">{action.status === 'completed' ? <Check size={17} /> : action.dueAtUtc && Date.parse(action.dueAtUtc) < Date.now() ? <TriangleAlert size={17} /> : <Bell size={17} />}</span><div><small>{CONTRACT_ACTION_LABELS[action.type]} · {CONTRACT_ACTION_STATUS_LABELS[action.status]}</small><strong>{action.title}</strong><span>{action.dueAtUtc ? `计划 ${new Date(action.dueAtUtc).toLocaleString('zh-CN', { hour12: false })}` : '未设置计划完成时间'}{reminder ? ` · 提醒 ${new Date(reminder.fireAtUtc).toLocaleString('zh-CN', { hour12: false })}` : ' · 未设置提醒'}</span></div><span className="row-actions">{action.status !== 'completed' && action.status !== 'waived' && <IconButton icon={Bell} label={`设置节点${action.title}的提醒`} onClick={() => { setReminderAction(action); setReminderText(localInput(reminder?.fireAtUtc ?? action.dueAtUtc)); setReminderError(null); }} />}{action.status !== 'completed' && <IconButton icon={Check} label={`完成节点${action.title}`} onClick={() => void setActionStatus({ actionId: action.id, status: 'completed', expectedStatus: action.status }).then((error) => notify(error ?? '合同节点已完成', error ? 'error' : 'success'))} />}<IconButton icon={Trash2} label={`删除节点${action.title}`} variant="danger" onClick={() => void removeAction(action.id).then((error) => notify(error ?? '合同节点已删除', error ? 'error' : 'success'))} /></span></li>;
    })}</ul>}
    <div className="contract-action-composer"><label className="ui-field"><span className="ui-field-label">节点类型</span><span className="ui-field-control"><select value={actionType} onChange={(event) => setActionType(event.target.value as ContractActionType)}>{Object.entries(CONTRACT_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span></label><Field label="节点名称" value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} /><Field label="计划完成时间" type="datetime-local" value={dueText} onChange={(event) => setDueText(event.target.value)} /><Field label="金额（最小单位）" inputMode="numeric" value={actionAmount} onChange={(event) => setActionAmount(event.target.value)} />{actionType === 'invoice' && <label className="ui-field"><span className="ui-field-label">关联付款节点</span><span className="ui-field-control"><select value={relatedActionId} onChange={(event) => setRelatedActionId(event.target.value)}><option value="">不关联</option>{actions.filter((action) => action.type === 'payment').map((action) => <option key={action.id} value={action.id}>{action.title}</option>)}</select></span></label>}<Button icon={Plus} variant="primary" disabled={!actionTitle.trim()} onClick={() => void createAction()}>添加节点</Button>{actionError && <AsyncFeedback tone="error" message={actionError} onRetry={() => void createAction()} />}</div>
    <Dialog open={reminderAction !== null} title="设置节点提醒" description={reminderAction?.title ?? ''} onClose={() => setReminderAction(null)} actions={<><Button variant="ghost" onClick={() => setReminderAction(null)}>取消</Button><Button variant="primary" onClick={() => void saveReminder()}>保存提醒</Button></>}><Field label="提醒时间" type="datetime-local" value={reminderText} error={reminderError} onChange={(event) => setReminderText(event.target.value)} /><Button variant="ghost" onClick={() => setReminderText('')}>清除提醒</Button></Dialog>
  </div>;
}
