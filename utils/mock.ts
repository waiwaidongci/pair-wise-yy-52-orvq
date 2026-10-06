import type { AuditEvent, MaintenanceBatch, Permit } from '~/types'

/** 同一份检修批次串起作业许可、隔离点、操作步骤和审计记录 */
export const batches: MaintenanceBatch[] = [
  {
    id: 'MB-260929-07',
    title: '09-29 风机/箱变/集电线路检修批次',
    createdAt: '2026-09-29T08:40:00+08:00',
    revision: 7,
    windSpeed: 10.8,
    busBoundary: 'BUS-A',
    permitIds: ['WP-260929-018', 'WP-260929-021', 'WP-260930-004'],
  },
]

export const permits: Permit[] = [
  {
    id: 'WP-260929-018',
    opNo: 'OP-260929-0101',
    batchId: 'MB-260929-07',
    baselineRevision: 7,
    occurredAt: '2026-09-29T08:40:00+08:00',
    title: '3 号风机齿轮箱更换',
    device: 'WTG-03 · 箱变 03',
    crew: '机务二班',
    owner: '李骁',
    window: '09-29 14:00 — 22:00',
    status: '执行中',
    risk: '一级',
    revision: 4,
    reviewRequired: false,
    invalidated: null,
    basis: { windSpeed: 10.8, device: 'WTG-03 · 箱变 03', busBoundary: 'BUS-A' },
    isolationPoints: [
      {
        id: 'IP-301', opNo: 'OP-260929-0102', device: 'WTG-03', label: '塔基 690V 主开关', type: '开关',
        state: '已隔离', baselineRevision: 7, occurredAt: '2026-09-29T14:12:00+08:00',
        fieldValues: [{ id: 'FV-301-1', value: '分位 · 机械锁定', actor: '周野', observedAt: '2026-09-29T14:12:00+08:00', source: '现场' }],
        lockConclusion: '有效',
      },
      {
        id: 'IP-302', opNo: 'OP-260929-0103', device: 'BOX-03', label: '箱变低压侧刀闸', type: '刀闸',
        state: '已隔离', baselineRevision: 7, occurredAt: '2026-09-29T14:26:00+08:00',
        fieldValues: [{ id: 'FV-302-1', value: '拉开并加挂锁 LK-2107', actor: '周野', observedAt: '2026-09-29T14:26:00+08:00', source: '现场' }],
        lockConclusion: '有效',
      },
      {
        id: 'IP-303', opNo: 'OP-260929-0104', device: 'WTG-03', label: '叶轮机械锁', type: '阀门',
        state: '已隔离', baselineRevision: 7, occurredAt: '2026-09-29T16:30:00+08:00',
        fieldValues: [
          { id: 'FV-303-1', value: '已入锁位 A（锁销到位）', actor: '周野', observedAt: '2026-09-29T16:30:00+08:00', source: '现场' },
          { id: 'FV-303-2', value: '锁销未到位（约 20mm 间隙）', actor: '何岚', observedAt: '2026-09-29T16:47:00+08:00', source: '现场' },
        ],
        lockConclusion: '待裁决',
      },
    ],
    steps: [
      { id: 'ST-01', opNo: 'OP-260929-0111', device: 'WTG-03', text: '核对工作票、设备双重编号与现场标识', done: true, owner: '周野', evidence: '现场照片 2 张', baselineRevision: 7, occurredAt: '2026-09-29T14:05:00+08:00' },
      { id: 'ST-02', opNo: 'OP-260929-0112', device: 'WTG-03', text: '断开 690V 主开关并执行机械锁定', done: true, owner: '周野', evidence: '锁具编号 LK-2107', baselineRevision: 7, occurredAt: '2026-09-29T14:14:00+08:00' },
      { id: 'ST-03', opNo: 'OP-260929-0113', device: 'WTG-03', text: '验电、放电并装设接地线', done: false, owner: '何岚', baselineRevision: 7, occurredAt: '2026-09-29T14:00:00+08:00' },
      { id: 'ST-04', opNo: 'OP-260929-0114', device: 'WTG-03', text: '全体作业人员确认隔离边界', done: false, owner: '李骁', baselineRevision: 7, occurredAt: '2026-09-29T14:00:00+08:00' },
    ],
  },
  {
    id: 'WP-260929-021',
    opNo: 'OP-260929-0201',
    batchId: 'MB-260929-07',
    baselineRevision: 7,
    occurredAt: '2026-09-29T15:20:00+08:00',
    title: '2 号集电线路绝缘子更换',
    device: 'LINE-A2 · 杆塔 17–23',
    crew: '线路一班',
    owner: '何岚',
    window: '09-29 18:00 — 30 02:00',
    status: '待复核',
    risk: '一级',
    revision: 2,
    reviewRequired: true,
    invalidated: null,
    basis: { windSpeed: 10.8, device: 'LINE-A2 · 杆塔 17–23', busBoundary: 'BUS-A' },
    isolationPoints: [
      { id: 'IP-411', opNo: 'OP-260929-0202', device: 'LINE-A2', label: 'A2 进线断路器', type: '开关', state: '待操作', baselineRevision: 7, occurredAt: '2026-09-29T15:20:00+08:00', fieldValues: [], lockConclusion: '有效' },
      { id: 'IP-412', opNo: 'OP-260929-0203', device: 'LINE-A2', label: '17 号杆接地刀闸', type: '接地', state: '待操作', baselineRevision: 7, occurredAt: '2026-09-29T15:20:00+08:00', fieldValues: [], lockConclusion: '有效' },
      { id: 'IP-413', opNo: 'OP-260929-0204', device: 'BUS-A', label: '母线侧隔离刀闸', type: '刀闸', state: '已隔离', baselineRevision: 7, occurredAt: '2026-09-29T16:10:00+08:00', fieldValues: [{ id: 'FV-413-1', value: '分位确认', actor: '孙禾', observedAt: '2026-09-29T16:10:00+08:00', source: '站内' }], lockConclusion: '有效' },
    ],
    steps: [
      { id: 'ST-11', opNo: 'OP-260929-0211', device: 'LINE-A2', text: '核对线路双重名称与停电范围', done: true, owner: '何岚', baselineRevision: 7, occurredAt: '2026-09-29T15:25:00+08:00' },
      { id: 'ST-12', opNo: 'OP-260929-0212', device: 'LINE-A2', text: '断开 A2 进线并完成五防校验', done: false, owner: '孙禾', baselineRevision: 7, occurredAt: '2026-09-29T15:20:00+08:00' },
      { id: 'ST-13', opNo: 'OP-260929-0213', device: 'LINE-A2', text: '17、23 号杆验电并装设接地线', done: false, owner: '谭勇', baselineRevision: 7, occurredAt: '2026-09-29T15:20:00+08:00' },
    ],
  },
  {
    id: 'WP-260930-004',
    opNo: 'OP-260930-0001',
    batchId: 'MB-260929-07',
    baselineRevision: 7,
    occurredAt: '2026-09-29T17:02:00+08:00',
    title: '箱变 12 温控器更换',
    device: 'BOX-12',
    crew: '电气一班',
    owner: '孙禾',
    window: '09-30 08:00 — 12:00',
    status: '待执行',
    risk: '二级',
    revision: 1,
    reviewRequired: false,
    invalidated: null,
    basis: { windSpeed: 10.8, device: 'BOX-12', busBoundary: 'BUS-A' },
    isolationPoints: [
      { id: 'IP-501', opNo: 'OP-260930-0002', device: 'BOX-12', label: '高压负荷开关', type: '开关', state: '待操作', baselineRevision: 7, occurredAt: '2026-09-29T17:02:00+08:00', fieldValues: [], lockConclusion: '有效' },
    ],
    steps: [
      { id: 'ST-21', opNo: 'OP-260930-0011', device: 'BOX-12', text: '核对箱变编号和低压侧负荷转移', done: true, owner: '孙禾', baselineRevision: 7, occurredAt: '2026-09-29T17:10:00+08:00' },
      { id: 'ST-22', opNo: 'OP-260930-0012', device: 'BOX-12', text: '断开高压负荷开关并锁定', done: false, owner: '孙禾', baselineRevision: 7, occurredAt: '2026-09-29T17:02:00+08:00' },
    ],
  },
]

export const auditEvents: AuditEvent[] = [
  {
    id: 'AE-901', opNo: 'OP-260929-0112', batchId: 'MB-260929-07', device: 'WTG-03',
    time: '14:14', occurredAt: '2026-09-29T14:14:00+08:00', actor: '李骁', action: '完成步骤',
    target: 'WP-260929-018 / ST-02', detail: '上传机械锁具编号 LK-2107', baselineRevision: 7, source: '站内',
  },
  {
    id: 'AE-902', opNo: 'OP-260929-9001', batchId: 'MB-260929-07',
    time: '16:18', occurredAt: '2026-09-29T16:18:00+08:00', actor: '系统', action: '冲突预警',
    target: 'LINE-A2', detail: '检测到线路一班与电气二班在 18:00–20:00 重叠作业', baselineRevision: 7, source: '站内',
  },
  {
    id: 'AE-903', opNo: 'OP-260929-9002', batchId: 'MB-260929-07',
    time: '15:56', occurredAt: '2026-09-29T15:56:00+08:00', actor: '赵清', action: '复核通过',
    target: 'WP-260929-014', detail: '同意执行，要求每 2 小时回报风速', baselineRevision: 6, source: '站内',
  },
  {
    id: 'AE-904', opNo: 'OP-260929-0104', batchId: 'MB-260929-07', device: 'WTG-03',
    time: '16:47', occurredAt: '2026-09-29T16:47:00+08:00', actor: '系统', action: '双值待裁决',
    target: 'WP-260929-018 / IP-303', detail: '叶轮机械锁出现两份现场读数，已挂起锁定结论等待值班负责人裁决', baselineRevision: 7, source: '站内',
  },
]
