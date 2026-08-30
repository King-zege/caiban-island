import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppService } from '../src/main/appService';
import { openDatabase } from '../src/main/db';

const roots: string[] = [];
const databases: Array<{ close(): void }> = [];
function fresh() {
  const root = mkdtempSync(path.join(tmpdir(), 'caiban-p24-')); roots.push(root);
  const db = openDatabase(path.join(root, 'island.db')); databases.push(db);
  return { app: new AppService(db, root), db };
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const base = {
  fullName: '总部办公电脑框架协议采购合同', shortName: '电脑框采合同', contractNo: 'HT-2026-001', supplierName: '示例科技有限公司',
  amountMinor: 12_345_678, currency: 'CNY', signedOn: '2026-08-01', effectiveOn: '2026-08-01', expiresOn: '2027-07-31',
  tzId: 'Asia/Shanghai', status: 'active' as const
};

describe('P24 合同台账与履约生命周期', () => {
  it('一个采购项目关联多个合同，也允许独立合同；金额保持整数精度', () => {
    const { app } = fresh();
    const project = app.createProcurementProject({ fullName: '总部终端采购项目', shortName: '终端采购', description: '', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai', procurementMethod: 'framework', templateId: null }).project;
    const first = app.createContract({ ...base, procurementProjectId: project.id });
    const second = app.createContract({ ...base, contractNo: 'HT-2026-002', shortName: '电脑框采二标', procurementProjectId: project.id });
    const standalone = app.createContract({ ...base, contractNo: '', shortName: '独立维保', fullName: '独立录入的维保合同', procurementProjectId: null });
    expect([first, second].every((contract) => contract.procurementProjectId === project.id)).toBe(true);
    expect(standalone.procurementProjectId).toBeNull();
    expect(app.contracts.detail(first.id).contract.amountMinor).toBe(12_345_678);
    expect(() => app.createContract({ ...base, procurementProjectId: null, amountMinor: 1.25 })).toThrow('整数最小货币单位');
  });

  it('付款、开票关联及状态提醒遵循合同边界', () => {
    const { app } = fresh();
    const contract = app.createContract({ ...base, procurementProjectId: null });
    const payment = app.addContractAction(contract.id, { type: 'payment', title: '支付首付款', description: '', dueAtUtc: '2099-09-01T00:00:00.000Z', amountMinor: 2_000_000, relatedActionId: null });
    const invoice = app.addContractAction(contract.id, { type: 'invoice', title: '取得首付款发票', description: '', dueAtUtc: '2099-08-28T00:00:00.000Z', amountMinor: 2_000_000, relatedActionId: payment.id });
    expect(invoice.relatedActionId).toBe(payment.id);
    const reminder = app.setContractActionReminder({ actionId: payment.id, fireAtUtc: '2099-08-31T01:00:00.000Z', expectedFireAtUtc: null });
    expect(reminder?.fired).toBe(false);
    app.setContractActionStatus({ actionId: payment.id, status: 'completed', expectedStatus: 'pending' });
    expect(app.contracts.detail(contract.id).reminders.find((item) => item.actionId === payment.id)?.fired).toBe(true);
    expect(() => app.setContractActionReminder({ actionId: payment.id, fireAtUtc: null, expectedFireAtUtc: '2099-08-31T01:00:00.000Z' })).toThrow('已完成或豁免');
  });

  it('到期提醒统一领取且关闭/归档停止、恢复只重建未来提醒', () => {
    const { app } = fresh();
    const contract = app.createContract({ ...base, procurementProjectId: null });
    const action = app.addContractAction(contract.id, { type: 'acceptance', title: '组织最终验收', description: '', dueAtUtc: '2099-09-01T00:00:00.000Z', amountMinor: null, relatedActionId: null });
    app.setContractActionReminder({ actionId: action.id, fireAtUtc: '2099-08-31T00:00:00.000Z', expectedFireAtUtc: null });
    expect(app.reminders.dueNow(new Date('2099-08-31T00:00:00.000Z'))).toEqual([expect.objectContaining({ kind: 'contract', contractId: contract.id, actionId: action.id })]);
    expect(app.reminders.dueNow(new Date('2099-08-31T00:00:00.000Z'))).toEqual([]);
    app.setContractActionStatus({ actionId: action.id, status: 'completed', expectedStatus: 'pending' });

    const future = app.addContractAction(contract.id, { type: 'archive', title: '合同归档', description: '', dueAtUtc: '2099-12-01T00:00:00.000Z', amountMinor: null, relatedActionId: null });
    app.setContractActionReminder({ actionId: future.id, fireAtUtc: '2099-11-30T00:00:00.000Z', expectedFireAtUtc: null });
    const archived = app.setContractStatus({ contractId: contract.id, status: 'archived', expectedStatus: 'active' });
    expect(archived.archivedFromStatus).toBe('active');
    expect(app.reminders.nextPendingAt()).toBeNull();
    app.restoreContract(contract.id);
    expect(app.reminders.nextPendingAt()).toBe('2099-11-30T00:00:00.000Z');
  });

  it('卡片返回供应商、下一动作和逾期风险，稳定按动作到期时间选择', () => {
    const { app } = fresh();
    const contract = app.createContract({ ...base, procurementProjectId: null });
    app.addContractAction(contract.id, { type: 'payment', title: '后付款', description: '', dueAtUtc: '2099-10-01T00:00:00.000Z', amountMinor: null, relatedActionId: null });
    app.addContractAction(contract.id, { type: 'invoice', title: '逾期开票', description: '', dueAtUtc: '2020-01-01T00:00:00.000Z', amountMinor: null, relatedActionId: null });
    expect(app.contracts.listCards(Date.parse('2026-08-29T00:00:00.000Z'))[0]).toMatchObject({
      contract: { supplierName: '示例科技有限公司' }, nextAction: { title: '逾期开票' }, pendingActionCount: 2, risk: 'overdue'
    });
  });
});
