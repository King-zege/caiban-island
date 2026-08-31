import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/main/db.ts';

const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : '';
const count = Number.parseInt(process.argv[3] ?? '7', 10);
const tempRoot = path.resolve(os.tmpdir());
const relative = targetDir ? path.relative(tempRoot, targetDir) : '..';

if (!targetDir || relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('视觉夹具目录必须是系统临时目录下的明确子目录');
}
if (!Number.isInteger(count) || count < 0 || count > 100) {
  throw new Error('任务数量必须是 0 到 100 的整数');
}

const db = openDatabase(path.join(targetDir, 'island.db'));
const now = new Date('2026-08-16T04:00:00.000Z');
const names = [
  '总部办公电脑批量采购',
  '仓库条码打印设备补充',
  '年度物流服务框架续签',
  '实验室安全防护用品采购',
  '华东区域门店网络设备升级与安装服务项目',
  '会议室显示系统更新',
  '新员工工位配套物资'
];
const nodeTitles = ['确认技术参数', '收集供应商报价', '完成比价评审', '签订采购合同', '确认到货验收'];
const urgencies = ['critical', 'high', 'normal', 'low'];

db.exec('BEGIN');
try {
  const projectIds = [];
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('onboarded', '1')").run();
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('acrylic_disabled', '1')").run();
  for (let index = 0; index < count; index += 1) {
    const taskId = randomUUID();
    projectIds.push(taskId);
    const deadline = new Date(now.getTime() + (index === 0 ? -86400000 : (index + 1) * 86400000));
    const name = names[index % names.length] + (index >= names.length ? ' ' + (index + 1) : '');
    db.prepare(`INSERT INTO tasks(
      id, name, description, kind, urgency, deadline_utc, tz_id, status, archived_at, archive_outcome, created_at, updated_at
    ) VALUES(?, ?, ?, 'procurement', ?, ?, 'Asia/Shanghai', 'active', NULL, NULL, ?, ?)`).run(
      taskId,
      name,
      '用于视觉回归的合成采购任务，不包含真实业务数据。',
      urgencies[index % urgencies.length],
      deadline.toISOString(),
      now.toISOString(),
      new Date(now.getTime() + index * 60000).toISOString()
    );
    for (let nodeIndex = 0; nodeIndex < nodeTitles.length; nodeIndex += 1) {
      const status = index === 2 && nodeIndex === nodeTitles.length - 1
        ? 'cancelled'
        : nodeIndex < index % 3 ? 'completed' : nodeIndex === index % 3 ? 'in_progress' : 'pending';
      db.prepare(`INSERT INTO nodes(id, task_id, title, description, start_utc, end_utc, status, position)
        VALUES(?, ?, ?, '', NULL, NULL, ?, ?)`).run(randomUUID(), taskId, nodeTitles[nodeIndex], status, nodeIndex);
    }
    db.prepare("INSERT INTO links(id, task_id, kind, title, target, meta) VALUES(?, ?, 'url', '供应商报价页面', 'https://example.com/quotation', '{}')")
      .run(randomUUID(), taskId);
    db.prepare('INSERT INTO notes(id, task_id, body, updated_at) VALUES(?, ?, ?, ?)')
      .run(randomUUID(), taskId, '- 已确认预算范围\n- 等待第二家供应商回复', now.toISOString());
  }
  const liveNow = Date.now();
  const miscFixtures = [
    { name: '联系物业续门禁卡', note: '带上旧卡和工牌。', remindAt: new Date(liveNow + 2 * 60 * 60 * 1000).toISOString() },
    { name: '把样品柜钥匙交给行政', note: '交接后在备注里记录接收人。', remindAt: new Date(liveNow + 26 * 60 * 60 * 1000).toISOString() },
    { name: '确认周五会议室', note: '无提醒的视觉回归杂事。', remindAt: null }
  ];
  for (let index = 0; index < miscFixtures.length; index += 1) {
    const fixture = miscFixtures[index];
    const taskId = randomUUID();
    const updatedAt = new Date(liveNow - index * 60000).toISOString();
    db.prepare(`INSERT INTO tasks(
      id, name, description, kind, urgency, deadline_utc, remind_at_utc, tz_id, status, archived_at, archive_outcome, created_at, updated_at
    ) VALUES(?, ?, '', 'misc', 'normal', NULL, ?, 'Asia/Shanghai', 'active', NULL, NULL, ?, ?)`).run(
      taskId, fixture.name, fixture.remindAt, updatedAt, updatedAt
    );
    db.prepare('INSERT INTO notes(id, task_id, body, updated_at) VALUES(?, ?, ?, ?)')
      .run(randomUUID(), taskId, fixture.note, updatedAt);
    if (fixture.remindAt) {
      db.prepare('INSERT INTO misc_reminders(task_id, fire_at_utc, fired) VALUES(?,?,0)')
        .run(taskId, fixture.remindAt);
    }
  }
  const contractFixtures = [
    { fullName: '总部办公电脑批量采购合同（第一批）', shortName: '电脑框采一批', no: 'HT-2026-001', supplier: '合成科技有限公司', action: '支付首付款', type: 'payment', offset: 3 },
    { fullName: '年度物流服务框架合同', shortName: '物流框架合同', no: 'HT-2026-002', supplier: '远途供应链有限公司', action: '提醒供应商开票', type: 'invoice', offset: 1 },
    { fullName: '实验室安全防护用品采购合同', shortName: '实验室防护合同', no: 'HT-2026-003', supplier: '安健工业用品有限公司', action: '到货验收', type: 'acceptance', offset: -1 }
  ];
  for (let index = 0; index < contractFixtures.length; index += 1) {
    const fixture = contractFixtures[index];
    const contractId = randomUUID();
    const actionId = randomUUID();
    const updatedAt = new Date(liveNow - index * 90000).toISOString();
    const dueAt = new Date(liveNow + fixture.offset * 86400000).toISOString();
    db.prepare(`INSERT INTO contracts(
      id, procurement_project_id, full_name, short_name, contract_no, supplier_name, amount_minor, currency,
      signed_on, effective_on, expires_on, tz_id, status, archived_from_status, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,'CNY','2026-08-01','2026-08-02','2027-08-01','Asia/Shanghai','active',NULL,?,?)`).run(
      contractId, projectIds[index] ?? null, fixture.fullName, fixture.shortName, fixture.no, fixture.supplier, 12800000 + index * 3500000, updatedAt, updatedAt
    );
    db.prepare(`INSERT INTO contract_actions(
      id, contract_id, type, title, description, due_at_utc, amount_minor, related_action_id, status, position, completed_at_utc, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,NULL,NULL,'pending',0,NULL,?,?)`).run(actionId, contractId, fixture.type, fixture.action, '合成视觉回归履约事项。', dueAt, updatedAt, updatedAt);
    if (fixture.offset >= 0) db.prepare('INSERT INTO contract_action_reminders(action_id, fire_at_utc, fired) VALUES(?,?,0)').run(actionId, dueAt);
  }
  const archivedId = randomUUID();
  const archivedAt = new Date(now.getTime() - 3 * 86400000).toISOString();
  db.prepare(`INSERT INTO tasks(
    id, name, description, kind, urgency, deadline_utc, tz_id, status, archived_at, archive_outcome, created_at, updated_at
  ) VALUES(?, '年度办公耗材框架采购', '视觉回归归档任务', 'task', 'normal', ?, 'Asia/Shanghai', 'archived', ?, 'completed', ?, ?)`).run(
    archivedId,
    new Date(now.getTime() - 4 * 86400000).toISOString(),
    archivedAt,
    new Date(now.getTime() - 12 * 86400000).toISOString(),
    archivedAt
  );
  for (let index = 0; index < 3; index += 1) {
    db.prepare(`INSERT INTO nodes(id, task_id, title, description, start_utc, end_utc, status, position)
      VALUES(?, ?, ?, '', NULL, NULL, 'completed', ?)`).run(randomUUID(), archivedId, nodeTitles[index], index);
  }
  db.prepare("INSERT INTO links(id, task_id, kind, title, target, meta) VALUES(?, ?, 'url', '归档报价依据', 'https://example.com/archive-quote', '{}')")
    .run(randomUUID(), archivedId);
  db.prepare('INSERT INTO notes(id, task_id, body, updated_at) VALUES(?, ?, ?, ?)').run(randomUUID(), archivedId, '供应商已按合同完成交付。', archivedAt);
  db.prepare('INSERT INTO change_events(task_id, at_utc, kind, detail) VALUES(?, ?, ?, ?)').run(archivedId, archivedAt, 'task_archived', '{}');

  const proposalPayload = {
    commands: [{
      name: 'create_procurement_project',
      input: {
        fullName: '会议室音视频设备采购项目', shortName: '会议室设备', description: '替换三间会议室的显示与拾音设备',
        urgency: 'high', deadlineUtc: new Date(now.getTime() + 14 * 86400000).toISOString(), tzId: 'Asia/Shanghai',
        procurementMethod: 'inquiry', templateId: null,
        nodes: nodeTitles.slice(0, 4).map((title) => ({ title, description: '', startUtc: null, endUtc: null, source: 'agent' }))
      }
    }],
    warnings: ['建议在询价前再次确认会议室接口规格']
  };
  db.prepare("INSERT INTO agent_proposals(id, session_id, kind, title, summary, payload, state, created_at, updated_at) VALUES(?, NULL, 'command_batch', '会议室设备采购方案', '合成视觉验收提案', ?, 'pending', ?, ?)")
    .run(randomUUID(), JSON.stringify(proposalPayload), now.toISOString(), now.toISOString());
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}

process.stdout.write('已创建 ' + count + ' 个合成任务：' + targetDir + '\n');
