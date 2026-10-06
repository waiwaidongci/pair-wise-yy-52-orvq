import { defineStore } from 'pinia'
import type { AuditEvent, BatchOperation, IsolationPoint, MaintenanceBatch, OpKind, Permit } from '~/types'
import { auditEvents as seedAudit, permits as seedPermits } from '~/utils/mock'

const STORAGE_KEY = 'yy52-permit-ops-v1'

function nowHM() { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) }
function isoNow() { return new Date().toISOString() }
function genOpNo() { return `OP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}` }
function genBatchNo() { return `BATCH-${Date.now().toString().slice(-6)}` }

// 叶轮机械锁 / 箱变低压侧刀闸：两份现场值留待值班负责人裁决
function isAdjudicatedPoint(point: IsolationPoint | undefined) {
  return !!point && (point.label.includes('叶轮机械锁') || point.label.includes('箱变低压侧刀闸'))
}

export const useOperationsStore = defineStore('operations', () => {
  const permits = ref<Permit[]>(structuredClone(seedPermits))
  const audit = ref<AuditEvent[]>(structuredClone(seedAudit))
  const batches = ref<MaintenanceBatch[]>([])
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const latestAlert = ref('18:00–20:00 LINE-A2 存在跨班组重叠作业')
  const loaded = ref(false)

  function persist() {
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, JSON.stringify({ permits: permits.value, audit: audit.value, batches: batches.value }))
  }
  function restore() {
    if (!import.meta.client || loaded.value) return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const draft = JSON.parse(raw)
      if (Array.isArray(draft.permits)) permits.value = draft.permits
      if (Array.isArray(draft.audit)) audit.value = draft.audit
      if (Array.isArray(draft.batches)) batches.value = draft.batches
    }
    loaded.value = true
  }
  function addAudit(actor: string, action: string, target: string, detail: string) {
    const ev: AuditEvent = { id: `AE-${Date.now().toString().slice(-5)}`, time: nowHM(), actor, action, target, detail }
    audit.value.unshift(ev)
    persist()
    return ev
  }

  function findPermitForTarget(targetId: string): Permit | undefined {
    return permits.value.find((p) => p.id === targetId)
      ?? permits.value.find((p) => p.steps.some((s) => s.id === targetId))
      ?? permits.value.find((p) => p.isolationPoints.some((ip) => ip.id === targetId))
  }

  // 按项合并：把一条操作应用到许可；同号操作幂等，不重复生成审计，不回退已复核状态
  function applyOp(op: BatchOperation): { ok: boolean; conflict: boolean; reason?: string } {
    if (op.merged) return { ok: true, conflict: false }
    // 幂等：同号操作已在任意批次合并过，不再多生成审计
    const already = batches.value.some((b) => b.ops.some((o) => o.opNo === op.opNo && o.merged && o !== op))
    if (already) { op.merged = true; return { ok: true, conflict: false } }

    const permit = findPermitForTarget(op.targetId)
    if (!permit) return { ok: false, conflict: false, reason: `找不到操作对象 ${op.targetId}` }
    const stale = op.baselineRevision < permit.revision
    let conflict = false

    if (op.kind === '步骤') {
      const step = permit.steps.find((s) => s.id === op.targetId)
      if (!step) return { ok: false, conflict: false, reason: `找不到步骤 ${op.targetId}` }
      step.done = op.done ?? true
    } else if (op.kind === '隔离点') {
      const point = permit.isolationPoints.find((ip) => ip.id === op.targetId)
      if (!point) return { ok: false, conflict: false, reason: `找不到隔离点 ${op.targetId}` }
      if (isAdjudicatedPoint(point) && op.fieldValue && point.state !== op.fieldValue) {
        // 叶轮机械锁 / 箱变低压侧刀闸存在两份现场值：不自动覆盖，留待值班负责人裁决
        conflict = true
        op.conflict = true
        permit.reviewRequired = true
        latestAlert.value = `${point.label} 存在两份现场值（在线：${point.state} / 现场：${op.fieldValue}），留待值班负责人裁决`
      } else if (op.fieldValue) {
        point.state = op.fieldValue
      }
    } else if (op.kind === '许可') {
      // 按项合并不回退许可状态：基线落后时只记录现场确认，不把许可拉回旧状态
      if (!stale && op.action === '流程推进') {
        const flow: Record<string, Permit['status']> = { 待复核: '待执行', 待执行: '执行中', 执行中: '待结束', 待结束: '待关闭', 待关闭: '已完成' }
        const next = flow[permit.status]
        if (next) { permit.status = next; permit.revision += 1 }
      }
    }

    if (!op.auditId) {
      const ev = addAudit(op.actor, op.action, `${permit.id} / ${op.targetId}`, conflict ? `两份现场值待裁决（在线/现场不一致）：${op.detail}` : op.detail)
      op.auditId = ev.id
    }
    op.merged = true
    return { ok: true, conflict }
  }

  // 回站补录：按项合并，检查点逐项推进；同号操作幂等
  function mergeBatch(batchId: string, opts: { failAt?: number } = {}) {
    const batch = batches.value.find((b) => b.id === batchId)
    if (!batch) return
    batch.status = '已合并'
    batch.failure = undefined
    for (let i = batch.checkpoint + 1; i < batch.ops.length; i++) {
      if (opts.failAt === i) {
        batch.status = '部分失败'
        batch.failure = `补录在第 ${i + 1} 项中断：现场连接瞬断`
        return
      }
      const res = applyOp(batch.ops[i]!)
      if (!res.ok) {
        batch.status = '部分失败'
        batch.failure = res.reason
        return
      }
      batch.checkpoint = i
    }
    batch.status = batch.ops.some((o) => o.conflict) ? '待裁决' : '已合并'
    persist()
  }

  // 补录失败后从最后完整检查点重试，同号操作不再多生成审计
  function retryBatch(batchId: string) {
    const batch = batches.value.find((b) => b.id === batchId)
    if (!batch) return
    const from = batch.checkpoint + 1
    mergeBatch(batchId)
    addAudit('系统', '重试成功', batchId, `从最后完整检查点（第 ${from} 项）继续补录，已合并项不重复生成审计`)
  }

  // 值班负责人裁决两份现场值
  function adjudicate(batchId: string, opNo: string, decision: '维持在线' | '采用现场' | '重新确认') {
    const batch = batches.value.find((b) => b.id === batchId)
    const op = batch?.ops.find((o) => o.opNo === opNo)
    if (!batch || !op) return
    const permit = findPermitForTarget(op.targetId)
    const point = permit?.isolationPoints.find((ip) => ip.id === op.targetId)
    if (decision === '采用现场' && point && op.fieldValue) point.state = op.fieldValue
    op.conflict = false
    op.detail = `${op.detail}；值班负责人裁决：${decision}`
    if (permit) { permit.reviewRequired = false; permit.revision += 1 }
    addAudit('值班负责人', '现场值裁决', `${permit?.id ?? ''} / ${op.targetId}`, `${point?.label ?? op.targetId} 两份现场值，裁决：${decision}`)
    if (!batch.ops.some((o) => o.conflict)) batch.status = '已合并'
    persist()
  }

  // 风速、设备编号或母线边界变化：相关锁定结论与许可阶段失效重算，其他许可沿用
  function invalidateContext(change: { windSpeed?: number; device?: string; busbar?: string }) {
    const reasons: string[] = []
    if (change.windSpeed !== undefined) reasons.push(`风速 ${change.windSpeed}m/s`)
    if (change.device) reasons.push(`设备编号 ${change.device}`)
    if (change.busbar) reasons.push(`母线边界 ${change.busbar}`)
    const reasonText = reasons.join('、')
    let invalidated = 0
    for (const permit of permits.value) {
      const windRelated = change.windSpeed !== undefined && permit.device.includes('WTG')
      const deviceRelated = !!change.device && permit.device.includes(change.device)
      const busbarRelated = !!change.busbar && permit.isolationPoints.some((ip) => ip.device === change.busbar || ip.label.includes(change.busbar!))
      if (!windRelated && !deviceRelated && !busbarRelated) continue
      // 锁定结论失效重算
      for (const ip of permit.isolationPoints) if (ip.state === '已隔离') ip.state = '待操作'
      permit.reviewRequired = true
      permit.status = '待复核'
      permit.revision += 1
      invalidated += 1
      addAudit('系统', '上下文失效重算', permit.id, `${reasonText} 变化，相关锁定结论与许可阶段失效，退回待复核重算`)
    }
    latestAlert.value = `上下文变化（${reasonText}）：${invalidated} 份许可失效重算，其他许可沿用`
    persist()
  }

  // 旧草稿缺操作号：升级成待复核批次
  function upgradeDrafts() {
    const referenced = new Set(batches.value.flatMap((b) => b.ops.map((o) => o.targetId)))
    const drafts = permits.value.filter((p) => !referenced.has(p.id))
    if (!drafts.length) return
    const ops: BatchOperation[] = drafts.map((p) => ({
      opNo: genOpNo(),
      kind: '许可' as OpKind,
      targetId: p.id,
      device: p.device,
      baselineRevision: p.revision,
      occurredAt: isoNow(),
      actor: '系统',
      action: '旧草稿升级',
      detail: `原草稿缺少操作号，基线修订 r${p.revision}，升级为待复核批次`,
      merged: false,
      conflict: false,
      invalidated: false,
    }))
    const batch: MaintenanceBatch = { id: genBatchNo(), source: '旧草稿升级', status: '待复核', createdAt: isoNow(), checkpoint: -1, ops }
    batches.value.unshift(batch)
    addAudit('系统', '旧草稿升级', batch.id, `${drafts.length} 份旧草稿缺少操作号，升级为待复核批次`)
    persist()
  }

  // 模拟断网现场：生成一份断网补录批次（叶轮机械锁两份现场值 → 待裁决）
  function simulateOfflineShift() {
    const permit = permits.value.find((p) => p.id === 'WP-260929-018') ?? permits.value[0]!
    const baseline = permit.revision
    const ip303 = permit.isolationPoints.find((ip) => ip.id === 'IP-303')
    const ip302 = permit.isolationPoints.find((ip) => ip.id === 'IP-302')
    const st03 = permit.steps.find((s) => s.id === 'ST-03')
    const st04 = permit.steps.find((s) => s.id === 'ST-04')
    const ops: BatchOperation[] = [
      { opNo: 'OP-1001', kind: '隔离点', targetId: ip303?.id ?? 'IP-303', device: permit.device, baselineRevision: baseline, occurredAt: isoNow(), actor: '周野', action: '现场确认隔离点', detail: '叶轮机械锁现场值与值班室状态不一致', fieldValue: '待操作', merged: false, conflict: false, invalidated: false },
      { opNo: 'OP-1002', kind: '隔离点', targetId: ip302?.id ?? 'IP-302', device: permit.device, baselineRevision: baseline, occurredAt: isoNow(), actor: '周野', action: '现场确认隔离点', detail: '箱变低压侧刀闸现场已隔离', fieldValue: '已隔离', merged: false, conflict: false, invalidated: false },
      { opNo: 'OP-1003', kind: '步骤', targetId: st03?.id ?? 'ST-03', device: permit.device, baselineRevision: baseline, occurredAt: isoNow(), actor: '何岚', action: '完成步骤', detail: st03?.text ?? '验电、放电并装设接地线', done: true, merged: false, conflict: false, invalidated: false },
      { opNo: 'OP-1004', kind: '步骤', targetId: st04?.id ?? 'ST-04', device: permit.device, baselineRevision: baseline, occurredAt: isoNow(), actor: '李骁', action: '完成步骤', detail: st04?.text ?? '全体作业人员确认隔离边界', done: true, merged: false, conflict: false, invalidated: false },
      { opNo: 'OP-1005', kind: '许可', targetId: permit.id, device: permit.device, baselineRevision: baseline, occurredAt: isoNow(), actor: '李骁', action: '现场确认许可状态', detail: `断网前基线修订 r${baseline}，回网后按项合并，不回退已复核状态`, merged: false, conflict: false, invalidated: false },
    ]
    const batch: MaintenanceBatch = { id: genBatchNo(), source: '断网补录', status: '待合并', createdAt: isoNow(), checkpoint: -1, ops }
    batches.value.unshift(batch)
    connection.value = '重连中'
    pendingRetry.value += 1
    persist()
    return batch.id
  }

  function backfillOffline(batchId: string, opts: { failAt?: number } = {}) {
    connection.value = '在线'
    pendingRetry.value = Math.max(0, pendingRetry.value - 1)
    mergeBatch(batchId, opts)
  }

  function markOffline() { connection.value = '重连中'; pendingRetry.value += 1 }
  function markOnline() { connection.value = '在线' }
  function retryPending() {
    pendingRetry.value = 0
    connection.value = '在线'
    addAudit('系统', '重试成功', '实时通道', '断线期间的现场确认已补传')
  }

  function advancePermit(id: string) {
    const permit = permits.value.find((item) => item.id === id)
    if (!permit) return
    const flow: Record<string, Permit['status']> = { 待复核: '待执行', 待执行: '执行中', 执行中: '待结束', 待结束: '待关闭', 待关闭: '已完成' }
    const next = flow[permit.status]
    if (!next) return
    if (permit.status === '待复核' && permit.reviewRequired && !confirm('该许可存在待复核冲突，确认由值班负责人承担审批责任？')) return
    permit.status = next
    permit.reviewRequired = false
    permit.revision += 1
    addAudit('当前用户', '流程推进', permit.id, `状态由“${Object.keys(flow).find((key) => flow[key] === next)}”变更为“${next}”`)
  }
  function toggleStep(permitId: string, stepId: string) {
    const permit = permits.value.find((item) => item.id === permitId)
    const step = permit?.steps.find((item) => item.id === stepId)
    if (!permit || !step) return
    const previous = permit.steps.filter((item) => item.done).length
    step.done = !step.done
    if (previous === 2 && permit.steps.filter((item) => item.done).length === 3 && permit.id === 'WP-260929-018') {
      latestAlert.value = 'WP-260929-018 检测到 LINE-A2 共用母线隔离点，需要复核'
      permit.reviewRequired = true
      permits.value.find((item) => item.id === 'WP-260929-021')!.reviewRequired = true
    }
    addAudit('当前用户', step.done ? '完成步骤' : '撤销步骤', `${permit.id} / ${step.id}`, step.text)
  }
  function addPermit(permit: Permit) { permits.value.unshift(permit); addAudit('当前用户', '新建许可', permit.id, permit.title) }
  function acceptAlert() { latestAlert.value = ''; addAudit('值班负责人', '确认冲突', '跨班组重叠', '同意调整 LINE-A2 作业时间，不允许同时开工') }

  restore()
  return {
    permits, audit, batches, connection, pendingRetry, latestAlert, loaded,
    addAudit, advancePermit, toggleStep, addPermit, acceptAlert,
    markOffline, markOnline, retryPending, restore,
    mergeBatch, retryBatch, adjudicate, invalidateContext, upgradeDrafts,
    simulateOfflineShift, backfillOffline, applyOp,
  }
})
