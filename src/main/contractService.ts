import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Contract,
  ContractAction,
  ContractActionInput,
  ContractActionReminder,
  ContractActionReminderRequest,
  ContractActionStatusRequest,
  ContractActionUpdateRequest,
  ContractCard,
  ContractCreateRequest,
  ContractDetail,
  ContractLink,
  ContractLinkInput,
  ContractRisk,
  ContractStatus,
  ContractStatusRequest,
  ContractUpdateRequest
} from '../shared/contractContracts';
import { CONTRACT_ACTION_STATUSES, CONTRACT_ACTION_TYPES, CONTRACT_STATUSES } from '../shared/contractContracts';
import { deriveShortName, validateFormalName, validateShortName } from '../shared/validation';

export class ContractError extends Error {}

function nullable(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null || row[key] === undefined ? null : String(row[key]);
}

function toContract(row: Record<string, unknown>): Contract {
  return {
    id: String(row.id), procurementProjectId: nullable(row, 'procurement_project_id'), fullName: String(row.full_name), shortName: String(row.short_name),
    contractNo: String(row.contract_no), supplierName: String(row.supplier_name), amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    currency: String(row.currency), signedOn: nullable(row, 'signed_on'), effectiveOn: nullable(row, 'effective_on'), expiresOn: nullable(row, 'expires_on'),
    tzId: String(row.tz_id), status: String(row.status) as Contract['status'], archivedFromStatus: nullable(row, 'archived_from_status') as Contract['archivedFromStatus'],
    createdAtUtc: String(row.created_at), updatedAtUtc: String(row.updated_at)
  };
}

function toAction(row: Record<string, unknown>): ContractAction {
  return {
    id: String(row.id), contractId: String(row.contract_id), type: String(row.type) as ContractAction['type'], title: String(row.title),
    description: String(row.description), dueAtUtc: nullable(row, 'due_at_utc'), amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    relatedActionId: nullable(row, 'related_action_id'), status: String(row.status) as ContractAction['status'], position: Number(row.position),
    completedAtUtc: nullable(row, 'completed_at_utc'), createdAtUtc: String(row.created_at), updatedAtUtc: String(row.updated_at)
  };
}

function toLink(row: Record<string, unknown>): ContractLink {
  return { id: String(row.id), contractId: String(row.contract_id), kind: String(row.kind) as ContractLink['kind'], title: String(row.title), target: String(row.target), meta: String(row.meta) };
}

function validDate(value: string | null): boolean {
  return value === null || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function validateAmount(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new ContractError('金额必须使用非负整数最小货币单位');
}

function normalizedNames(input: Pick<ContractCreateRequest, 'fullName' | 'shortName'>): { fullName: string; shortName: string } {
  const requestedFullName = input.fullName.trim();
  const requestedShortName = input.shortName.trim();
  if (!requestedFullName && !requestedShortName) throw new ContractError('请至少填写合同正式全名或卡片简称');
  const fullName = requestedFullName || requestedShortName;
  const shortName = requestedShortName || deriveShortName(fullName).shortName;
  return { fullName, shortName };
}

function validateFields(input: Omit<ContractCreateRequest, 'status'>): { fullName: string; shortName: string } {
  const names = normalizedNames(input);
  const full = validateFormalName(names.fullName); const short = validateShortName(names.shortName);
  if (!full.ok || !short.ok) throw new ContractError([...(!full.ok ? full.errors : []), ...(!short.ok ? short.errors : [])].join('；'));
  if (input.contractNo.trim().length > 100) throw new ContractError('合同号不能超过 100 个字符');
  if (input.supplierName.trim().length > 300) throw new ContractError('供应商名称不能超过 300 个字符');
  validateAmount(input.amountMinor);
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new ContractError('币种必须是三位大写代码');
  if (![input.signedOn, input.effectiveOn, input.expiresOn].every(validDate)) throw new ContractError('合同日期格式无效');
  if (input.effectiveOn && input.expiresOn && input.effectiveOn > input.expiresOn) throw new ContractError('合同到期日不能早于生效日');
  if (!input.tzId) throw new ContractError('缺少时区信息');
  return names;
}

function validateCreate(input: ContractCreateRequest): void {
  validateFields(input);
  if (input.status !== 'draft' && input.status !== 'active') throw new ContractError('新合同状态无效');
}

function validateAction(input: ContractActionInput): void {
  if (!CONTRACT_ACTION_TYPES.includes(input.type)) throw new ContractError('履约动作类型无效');
  const title = input.title.trim();
  if (!title || title.length > 200) throw new ContractError('履约动作标题必须为 1–200 个字符');
  if (input.dueAtUtc !== null && !Number.isFinite(Date.parse(input.dueAtUtc))) throw new ContractError('履约动作到期时间无效');
  validateAmount(input.amountMinor);
}

export class ContractService {
  constructor(private readonly db: DatabaseSync) {}

  listCards(nowMs = Date.now()): ContractCard[] {
    const contracts = (this.db.prepare("SELECT * FROM contracts WHERE status IN ('draft','active','closing') ORDER BY updated_at DESC, id").all() as unknown as Record<string, unknown>[]).map(toContract);
    return contracts.map((contract) => {
      const actions = this.listActions(contract.id).filter((action) => action.status === 'pending' || action.status === 'in_progress');
      const nextAction = [...actions].sort((left, right) => (left.dueAtUtc ?? '9999').localeCompare(right.dueAtUtc ?? '9999') || left.position - right.position || left.id.localeCompare(right.id))[0] ?? null;
      return { contract, nextAction, pendingActionCount: actions.length, risk: this.risk(nextAction, nowMs) };
    });
  }

  get(id: string): Contract | null {
    const row = this.db.prepare('SELECT * FROM contracts WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? toContract(row) : null;
  }

  detail(id: string): ContractDetail {
    const contract = this.get(id);
    if (!contract) throw new ContractError('合同不存在');
    const links = (this.db.prepare('SELECT * FROM contract_links WHERE contract_id=? ORDER BY rowid').all(id) as unknown as Record<string, unknown>[]).map(toLink);
    const note = this.db.prepare('SELECT body FROM contract_notes WHERE contract_id=?').get(id) as { body: string } | undefined;
    const reminders = this.db.prepare(
      'SELECT r.action_id AS actionId, r.fire_at_utc AS fireAtUtc, r.fired FROM contract_action_reminders r JOIN contract_actions a ON a.id=r.action_id WHERE a.contract_id=? ORDER BY r.fire_at_utc, r.action_id'
    ).all(id) as unknown as Array<{ actionId: string; fireAtUtc: string; fired: number }>;
    return { contract, actions: this.listActions(id), links, note: note?.body ?? '', reminders: reminders.map((row) => ({ actionId: row.actionId, fireAtUtc: row.fireAtUtc, fired: row.fired === 1 })) };
  }

  create(input: ContractCreateRequest): Contract {
    validateCreate(input);
    const names = normalizedNames(input);
    this.assertProject(input.procurementProjectId);
    const now = new Date().toISOString(); const id = randomUUID();
    this.db.prepare(
      `INSERT INTO contracts(id, procurement_project_id, full_name, short_name, contract_no, supplier_name, amount_minor, currency, signed_on, effective_on, expires_on, tz_id, status, archived_from_status, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`
    ).run(id, input.procurementProjectId, names.fullName, names.shortName, input.contractNo.trim(), input.supplierName.trim(), input.amountMinor, input.currency, input.signedOn, input.effectiveOn, input.expiresOn, input.tzId, input.status, now, now);
    this.log(id, 'contract_created', { status: input.status, projectLinked: Boolean(input.procurementProjectId) });
    return this.get(id) as Contract;
  }

  update(request: ContractUpdateRequest): Contract {
    const names = validateFields(request); this.assertProject(request.procurementProjectId);
    const existing = this.get(request.contractId);
    if (!existing || existing.status === 'archived') throw new ContractError('合同不存在或不可编辑');
    if (existing.updatedAtUtc !== request.expectedUpdatedAtUtc) throw new ContractError('合同已变化，请刷新后重试');
    const updatedAt = this.nextTimestamp(existing.updatedAtUtc);
    const result = this.db.prepare(
      `UPDATE contracts SET procurement_project_id=?, full_name=?, short_name=?, contract_no=?, supplier_name=?, amount_minor=?, currency=?, signed_on=?, effective_on=?, expires_on=?, tz_id=?, updated_at=?
       WHERE id=? AND updated_at=? AND status<>'archived'`
    ).run(request.procurementProjectId, names.fullName, names.shortName, request.contractNo.trim(), request.supplierName.trim(), request.amountMinor, request.currency, request.signedOn, request.effectiveOn, request.expiresOn, request.tzId, updatedAt, request.contractId, request.expectedUpdatedAtUtc);
    if (result.changes !== 1) throw new ContractError('合同已变化，请刷新后重试');
    this.log(request.contractId, 'contract_updated', { projectLinked: Boolean(request.procurementProjectId) });
    return this.get(request.contractId) as Contract;
  }

  setStatus(request: ContractStatusRequest): Contract {
    if (!CONTRACT_STATUSES.includes(request.status) || !CONTRACT_STATUSES.includes(request.expectedStatus)) throw new ContractError('合同状态无效');
    const existing = this.get(request.contractId);
    if (!existing || existing.status !== request.expectedStatus) throw new ContractError('合同状态已变化，请刷新后重试');
    const target = request.status === 'archived' ? 'archived' : request.status;
    if (!this.transitionAllowed(existing.status, target)) throw new ContractError(`合同不能从 ${existing.status} 变更为 ${target}`);
    const archivedFrom = target === 'archived' ? existing.status : existing.archivedFromStatus;
    const updatedAt = this.nextTimestamp(existing.updatedAtUtc);
    this.db.prepare('UPDATE contracts SET status=?, archived_from_status=?, updated_at=? WHERE id=? AND status=?').run(target, archivedFrom, updatedAt, existing.id, request.expectedStatus);
    if (['closed', 'terminated', 'archived'].includes(target)) this.db.prepare(
      'UPDATE contract_action_reminders SET fired=1 WHERE action_id IN (SELECT id FROM contract_actions WHERE contract_id=?)'
    ).run(existing.id);
    else this.db.prepare(
      "UPDATE contract_action_reminders SET fired=0 WHERE fire_at_utc>? AND action_id IN (SELECT id FROM contract_actions WHERE contract_id=? AND status IN ('pending','in_progress'))"
    ).run(new Date().toISOString(), existing.id);
    this.log(existing.id, 'contract_status', { from: existing.status, to: target });
    return this.get(existing.id) as Contract;
  }

  restoreArchived(id: string): Contract {
    const existing = this.get(id);
    if (!existing || existing.status !== 'archived') throw new ContractError('合同未归档');
    const restored = existing.archivedFromStatus ?? 'active';
    return this.setStatus({ contractId: id, status: restored, expectedStatus: 'archived' });
  }

  listActions(contractId: string): ContractAction[] {
    return (this.db.prepare('SELECT * FROM contract_actions WHERE contract_id=? ORDER BY position, id').all(contractId) as unknown as Record<string, unknown>[]).map(toAction);
  }

  addAction(contractId: string, input: ContractActionInput): ContractAction {
    validateAction(input); const contract = this.assertEditable(contractId); this.assertRelated(contractId, input.relatedActionId, null, input.type);
    const max = this.db.prepare('SELECT MAX(position) AS value FROM contract_actions WHERE contract_id=?').get(contractId) as { value: number | null };
    const now = new Date().toISOString(); const id = randomUUID();
    this.db.prepare(
      'INSERT INTO contract_actions(id, contract_id, type, title, description, due_at_utc, amount_minor, related_action_id, status, position, completed_at_utc, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(id, contractId, input.type, input.title.trim(), input.description.trim(), input.dueAtUtc, input.amountMinor, input.relatedActionId, 'pending', (max.value ?? -1) + 1, null, now, now);
    this.touch(contract); this.log(contractId, 'contract_action_added', { actionId: id, type: input.type });
    return this.action(id);
  }

  updateAction(request: ContractActionUpdateRequest): ContractAction {
    validateAction(request.input); const existing = this.action(request.actionId); const contract = this.assertEditable(existing.contractId);
    if (existing.updatedAtUtc !== request.expectedUpdatedAtUtc) throw new ContractError('履约动作已变化，请刷新后重试');
    this.assertRelated(existing.contractId, request.input.relatedActionId, existing.id, request.input.type);
    const updatedAt = this.nextTimestamp(existing.updatedAtUtc);
    const result = this.db.prepare(
      'UPDATE contract_actions SET type=?, title=?, description=?, due_at_utc=?, amount_minor=?, related_action_id=?, updated_at=? WHERE id=? AND updated_at=?'
    ).run(request.input.type, request.input.title.trim(), request.input.description.trim(), request.input.dueAtUtc, request.input.amountMinor, request.input.relatedActionId, updatedAt, existing.id, request.expectedUpdatedAtUtc);
    if (result.changes !== 1) throw new ContractError('履约动作已变化，请刷新后重试');
    this.touch(contract); this.log(contract.id, 'contract_action_updated', { actionId: existing.id });
    return this.action(existing.id);
  }

  setActionStatus(request: ContractActionStatusRequest): ContractAction {
    if (!CONTRACT_ACTION_STATUSES.includes(request.status) || !CONTRACT_ACTION_STATUSES.includes(request.expectedStatus)) throw new ContractError('履约动作状态无效');
    const existing = this.action(request.actionId); const contract = this.assertEditable(existing.contractId);
    if (existing.status !== request.expectedStatus) throw new ContractError('履约动作状态已变化，请刷新后重试');
    const updatedAt = this.nextTimestamp(existing.updatedAtUtc);
    const completedAt = request.status === 'completed' ? new Date().toISOString() : null;
    this.db.prepare('UPDATE contract_actions SET status=?, completed_at_utc=?, updated_at=? WHERE id=? AND status=?').run(request.status, completedAt, updatedAt, existing.id, request.expectedStatus);
    if (request.status === 'completed' || request.status === 'waived') this.db.prepare('UPDATE contract_action_reminders SET fired=1 WHERE action_id=?').run(existing.id);
    else this.db.prepare('UPDATE contract_action_reminders SET fired=CASE WHEN fire_at_utc>? THEN 0 ELSE fired END WHERE action_id=?').run(new Date().toISOString(), existing.id);
    this.touch(contract); this.log(contract.id, 'contract_action_status', { actionId: existing.id, from: request.expectedStatus, to: request.status });
    return this.action(existing.id);
  }

  removeAction(id: string): void {
    const action = this.action(id); const contract = this.assertEditable(action.contractId);
    this.db.prepare('DELETE FROM contract_actions WHERE id=?').run(id);
    this.db.prepare('UPDATE contract_actions SET position=position-1 WHERE contract_id=? AND position>?').run(action.contractId, action.position);
    this.touch(contract); this.log(contract.id, 'contract_action_removed', { actionId: id });
  }

  setActionReminder(request: ContractActionReminderRequest, nowMs = Date.now()): ContractActionReminder | null {
    const action = this.action(request.actionId); const contract = this.assertEditable(action.contractId);
    if (action.status !== 'pending' && action.status !== 'in_progress') throw new ContractError('已完成或豁免的动作不能设置提醒');
    const current = this.reminder(action.id);
    if ((current?.fireAtUtc ?? null) !== request.expectedFireAtUtc) throw new ContractError('动作提醒已变化，请刷新后重试');
    if (request.fireAtUtc === null) { this.db.prepare('DELETE FROM contract_action_reminders WHERE action_id=?').run(action.id); this.touch(contract); return null; }
    if (!Number.isFinite(Date.parse(request.fireAtUtc)) || Date.parse(request.fireAtUtc) <= nowMs) throw new ContractError('动作提醒必须晚于当前时间');
    this.db.prepare(
      'INSERT INTO contract_action_reminders(action_id, fire_at_utc, fired) VALUES(?,?,0) ON CONFLICT(action_id) DO UPDATE SET fire_at_utc=excluded.fire_at_utc, fired=0'
    ).run(action.id, request.fireAtUtc);
    this.touch(contract); this.log(contract.id, 'contract_action_reminder', { actionId: action.id });
    return this.reminder(action.id);
  }

  addLink(contractId: string, input: ContractLinkInput): ContractLink {
    const contract = this.assertEditable(contractId); const target = input.target.trim();
    if (input.kind === 'url' ? !/^https?:\/\/\S+$/i.test(target) : !target) throw new ContractError(input.kind === 'url' ? '网址仅支持 http/https' : '文件路径不能为空');
    const id = randomUUID(); const title = input.title.trim() || target;
    this.db.prepare('INSERT INTO contract_links(id, contract_id, kind, title, target, meta) VALUES(?,?,?,?,?,?)').run(id, contractId, input.kind, title, target, JSON.stringify({ addedAt: new Date().toISOString() }));
    this.touch(contract); this.log(contractId, 'contract_link_added', { linkId: id, kind: input.kind });
    return toLink(this.db.prepare('SELECT * FROM contract_links WHERE id=?').get(id) as Record<string, unknown>);
  }

  removeLink(id: string): void {
    const row = this.db.prepare('SELECT contract_id FROM contract_links WHERE id=?').get(id) as { contract_id: string } | undefined;
    if (!row) throw new ContractError('合同资料不存在'); const contract = this.assertEditable(row.contract_id);
    this.db.prepare('DELETE FROM contract_links WHERE id=?').run(id); this.touch(contract); this.log(contract.id, 'contract_link_removed', { linkId: id });
  }

  saveNote(contractId: string, body: string): void {
    const contract = this.assertEditable(contractId); const now = new Date().toISOString();
    this.db.prepare('INSERT INTO contract_notes(contract_id, body, updated_at) VALUES(?,?,?) ON CONFLICT(contract_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at').run(contractId, body, now);
    this.touch(contract); this.log(contract.id, 'contract_note_saved', { chars: body.length });
  }

  private action(id: string): ContractAction {
    const row = this.db.prepare('SELECT * FROM contract_actions WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new ContractError('履约动作不存在'); return toAction(row);
  }

  private reminder(actionId: string): ContractActionReminder | null {
    const row = this.db.prepare('SELECT action_id, fire_at_utc, fired FROM contract_action_reminders WHERE action_id=?').get(actionId) as { action_id: string; fire_at_utc: string; fired: number } | undefined;
    return row ? { actionId: row.action_id, fireAtUtc: row.fire_at_utc, fired: row.fired === 1 } : null;
  }

  private assertProject(id: string | null): void {
    if (!id) return;
    const project = this.db.prepare("SELECT id FROM tasks WHERE id=? AND kind='procurement'").get(id);
    if (!project) throw new ContractError('关联采购项目不存在');
  }

  private assertEditable(id: string): Contract {
    const contract = this.get(id);
    if (!contract || contract.status === 'closed' || contract.status === 'terminated' || contract.status === 'archived') throw new ContractError('合同不存在或当前状态不可编辑');
    return contract;
  }

  private assertRelated(contractId: string, relatedId: string | null, selfId: string | null, type: ContractAction['type']): void {
    if (!relatedId) return;
    if (relatedId === selfId) throw new ContractError('履约动作不能关联自身');
    const related = this.action(relatedId);
    if (related.contractId !== contractId) throw new ContractError('关联动作必须属于同一合同');
    if (type === 'invoice' && related.type !== 'payment') throw new ContractError('开票事项只能关联付款事项');
  }

  private transitionAllowed(from: ContractStatus, to: ContractStatus): boolean {
    if (from === to) return true;
    if (from === 'archived') return to !== 'archived';
    if (to === 'archived') return true;
    const allowed: Record<Exclude<ContractStatus, 'archived'>, ContractStatus[]> = {
      draft: ['active', 'terminated'], active: ['closing', 'closed', 'terminated'], closing: ['active', 'closed', 'terminated'], closed: [], terminated: []
    };
    return allowed[from as Exclude<ContractStatus, 'archived'>].includes(to);
  }

  private risk(action: ContractAction | null, nowMs: number): ContractRisk {
    if (!action?.dueAtUtc) return action ? 'normal' : 'none';
    const due = Date.parse(action.dueAtUtc);
    if (due < nowMs) return 'overdue';
    if (due <= nowMs + 7 * 86400000) return 'due_soon';
    return 'normal';
  }

  private touch(contract: Contract): void {
    this.db.prepare('UPDATE contracts SET updated_at=? WHERE id=?').run(this.nextTimestamp(contract.updatedAtUtc), contract.id);
  }

  private nextTimestamp(previous: string): string { return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString(); }
  private log(contractId: string, kind: string, detail: Record<string, unknown>): void {
    this.db.prepare('INSERT INTO contract_change_events(contract_id, at_utc, kind, detail) VALUES(?,?,?,?)').run(contractId, new Date().toISOString(), kind, JSON.stringify(detail));
  }
}
