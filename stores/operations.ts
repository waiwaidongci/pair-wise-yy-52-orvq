import { defineStore } from 'pinia'
import type {
  AuditEvent,
  InvalidationReason,
  IsolationPoint,
  MaintenanceBatch,
  OfflineRecord,
  Permit,
  SyncCheckpoint,
} from '~/types'
import {
  adjudicatePoint,
  appendFieldValue,
  hasPendingConflict,
  invalidateForBasisChange,
  mergeOfflineRecords,
  nextStatus,
  permitBlocked,
  reconfirmPermit,
  upgradeLegacyDraft,
} from '~/utils/batch'
import { auditEvents as seedAudit, batches as seedBatches, permits as seedPermits } from '~/utils/mock'

const STORAGE_KEY = 'yy52-permit-ops-v2'
const LEGACY_STORAGE_KEY = 'yy52-permit-ops-v1'
const WIND_SUSPEND_LIMIT = 10

function clockNow() {
  return new Date().toISOString()
}
function hm(iso: string) {
  return iso.slice(11, 16)
}

interface PersistShape {
  version: 2
  batches: MaintenanceBatch[]
  permits: Permit[]
  audit: AuditEvent[]
  outbox: OfflineRecord[]
  checkpoint: SyncCheckpoint | null
  appliedOpNos: string[]
  opSequence: number
}

export const useOperationsStore = defineStore('operations', () => {
  const batches = ref<MaintenanceBatch[]>(structuredClone(seedBatches))
  const permits = ref<Permit[]>(structuredClone(seedPermits))
  const audit = ref<AuditEvent[]>(structuredClone(seedAudit))
  const outbox = ref<OfflineRecord[]>([])
  const connection = ref<'在线' | '塔基断网' | '重连中'>('在线')
  const checkpoint = ref<SyncCheckpoint | null>(null)
  const appliedOpNos = ref<string[]>(audit.value.map((item) => item.opNo))
  const syncState = ref<{ status: 'idle' | 'success' | 'failed'; message: string }>({ status: 'idle', message: '' })
  const opSequence = ref(9100)
  const latestAlert = ref('18:00–20:00 LINE-A2 存在跨班组重叠作业')
  const loaded = ref(false)

  const batch = computed(() => batches.value[0])
  const pendingRetry = computed(() => outbox.value.filter((record) => !record.applied).length)
  const conflictPermits = computed(() =>
    permits.value.filter((permit) => permit.reviewRequired || permit.invalidated || permit.isolationPoints.some(hasPendingConflict)),
  )

  function persist() {
    if (!import.meta.client) return
    const payload: PersistShape = {
      version: 2,
      batches: batches.value,
      permits: permits.value,
      audit: audit.value,
      outbox: outbox.value,
      checkpoint: checkpoint.value,
      appliedOpNos: appliedOpNos.value,
      opSequence: opSequence.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }

  function restore() {
    if (!import.meta.client || loaded.value) return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as PersistShape
      batches.value = data.batches ?? batches.value
      permits.value = data.permits
      audit.value = data.audit
      outbox.value = data.outbox ?? []
      checkpoint.value = data.checkpoint ?? null
      appliedOpNos.value = data.appliedOpNos ?? audit.value.map((item) => item.opNo)
      opSequence.value = data.opSequence ?? 9100
    } else {
      // 旧草稿（无操作号、无批次结构）升级为待复核批次
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (legacyRaw) {
        const legacyDraft = JSON.parse(legacyRaw)
        const { batch: legacyBatch, permits: legacyPermits } = upgradeLegacyDraft(legacyDraft)
        const legacyPermitIds = new Set(legacyPermits.map((permit) => permit.id))
        batches.value.unshift(legacyBatch)
        permits.value = [...legacyPermits, ...permits.value.filter((permit) => !legacyPermitIds.has(permit.id))]
        legacyPermits.forEach((permit) => {
          audit.value.unshift({
            id: `AE-UPG-${permit.id.slice(-6)}`,
            opNo: `${permit.opNo}-UPGRADE`,
            batchId: legacyBatch.id,
            device: permit.device,
            time: hm(permit.occurredAt),
            occurredAt: permit.occurredAt,
            actor: '系统',
            action: '草稿升级',
            target: permit.id,
            detail: '旧草稿缺少操作号，已补齐操作号与基线修订并升级为待复核批次',
            baselineRevision: 1,
            source: '站内',
          })
        })
        // 立刻落盘为 v2，避免刷新后重复升级
        persist()
      }
    }
    loaded.value = true
  }

  function nextOpNo() {
    opSequence.value += 1
    return `OP-RT-${opSequence.value}`
  }

  /** 同号操作只允许生成一条审计 */
  function addAudit(
    entry: Omit<AuditEvent, 'id' | 'time' | 'occurredAt'> & { occurredAt?: string },
  ): AuditEvent | null {
    if (appliedOpNos.value.includes(entry.opNo) || audit.value.some((item) => item.opNo === entry.opNo)) return null
    const occurredAt = entry.occurredAt ?? clockNow()
    const event: AuditEvent = {
      ...entry,
      id: `AE-${opSequence.value}-${occurredAt.slice(17, 19)}`,
      time: hm(occurredAt),
      occurredAt,
    }
    audit.value.unshift(event)
    appliedOpNos.value.push(entry.opNo)
    persist()
    return event
  }

  function findPermit(permitId: string) {
    return permits.value.find((item) => item.id === permitId)
  }
  function findPoint(permitId: string, pointId: string): { permit: Permit; point: IsolationPoint } | undefined {
    const permit = findPermit(permitId)
    const point = permit?.isolationPoints.find((item) => item.id === pointId)
    return permit && point ? { permit, point } : undefined
  }

  // ---- 在线操作 -----------------------------------------------------------

  function advancePermit(permitId: string) {
    const permit = findPermit(permitId)
    if (!permit) return { ok: false, message: '许可不存在' }
    const blocked = permitBlocked(permit)
    if (blocked) return { ok: false, message: blocked }
    const next = nextStatus(permit.status)
    if (!next) return { ok: false, message: '该许可已完成' }

    const opNo = nextOpNo()
    const previous = permit.status
    permit.status = next
    permit.revision += 1
    permit.baselineRevision = batch.value.revision
    if (!permit.isolationPoints.some(hasPendingConflict) && !permit.invalidated) permit.reviewRequired = false
    addAudit({
      opNo,
      batchId: permit.batchId,
      device: permit.device,
      actor: '当前用户',
      action: '流程推进',
      target: permit.id,
      detail: `状态由“${previous}”变更为“${next}”，基线修订 r${batch.value.revision}`,
      baselineRevision: batch.value.revision,
      source: '站内',
    })
    return { ok: true, message: `已推进至「${next}」（${opNo}）` }
  }

  function toggleStep(permitId: string, stepId: string): { offline?: boolean; opNo?: string } {
    const permit = findPermit(permitId)
    const step = permit?.steps.find((item) => item.id === stepId)
    if (!permit || !step) return {}

    if (connection.value !== '在线') {
      const opNo = queueOffline({
        batchId: permit.batchId,
        permitId: permit.id,
        device: step.device,
        kind: 'step-toggle',
        targetId: step.id,
        actor: '当前用户',
        baselineRevision: permit.baselineRevision,
        done: !step.done,
      })
      return { offline: true, opNo }
    }

    const opNo = nextOpNo()
    const now = clockNow()
    step.done = !step.done
    step.baselineRevision = batch.value.revision
    step.occurredAt = now
    addAudit({
      opNo,
      batchId: permit.batchId,
      device: step.device,
      actor: '当前用户',
      action: step.done ? '完成步骤' : '撤销步骤',
      target: `${permit.id} / ${step.id}`,
      detail: `${step.text}，基线修订 r${batch.value.revision}`,
      baselineRevision: batch.value.revision,
      source: '站内',
    })
  }

  function submitFieldValue(permitId: string, pointId: string, value: string, source: '站内' | '现场' = '站内') {
    const hit = findPoint(permitId, pointId)
    if (!hit) return { ok: false, message: '隔离点不存在' }
    const { permit, point } = hit

    if (connection.value !== '在线' && source === '现场') {
      queueOffline({
        batchId: permit.batchId,
        permitId: permit.id,
        device: point.device,
        kind: 'field-value',
        targetId: point.id,
        actor: '当前用户',
        baselineRevision: permit.baselineRevision,
        value,
      })
      return { ok: false, offline: true, message: '塔基断网：读数已记入待补录队列' }
    }

    const opNo = nextOpNo()
    const occurredAt = clockNow()
    const outcome = appendFieldValue(point, {
      id: opNo,
      value,
      actor: '当前用户',
      observedAt: occurredAt,
      source,
    })
    if (outcome === 'duplicate') return { ok: false, message: '同号现场值已存在，未重复入库' }
    point.baselineRevision = batch.value.revision
    if (outcome === 'conflict') permit.reviewRequired = true

    addAudit({
      opNo,
      batchId: permit.batchId,
      device: point.device,
      actor: '当前用户',
      action: '现场读数',
      target: `${permit.id} / ${point.id}`,
      detail: `「${point.label}」记录现场值：${value}${outcome === 'conflict' ? '；两份现场值不一致，留待值班负责人裁决' : ''}`,
      baselineRevision: batch.value.revision,
      source,
    })
    return {
      ok: true,
      conflict: outcome === 'conflict',
      message: outcome === 'conflict' ? '「' + point.label + '」两份现场值冲突，已挂起等待值班负责人裁决' : '现场值已入库',
    }
  }

  /** 值班负责人裁决叶轮机械锁 / 箱变低压侧刀闸的双份现场值 */
  function adjudicate(permitId: string, pointId: string, valueId: string) {
    const hit = findPoint(permitId, pointId)
    if (!hit) return { ok: false, message: '隔离点不存在' }
    const { permit, point } = hit
    const chosen = point.fieldValues.find((item) => item.id === valueId)
    if (!chosen) return { ok: false, message: '待采纳的现场值不存在' }
    if (!adjudicatePoint(point, valueId, batch.value.revision)) return { ok: false, message: '裁决失败' }
    if (!permit.isolationPoints.some(hasPendingConflict)) permit.reviewRequired = false
    addAudit({
      opNo: nextOpNo(),
      batchId: permit.batchId,
      device: point.device,
      actor: '值班负责人',
      action: '双值裁决',
      target: `${permit.id} / ${point.id}`,
      detail: `采纳「${chosen.value}」（${chosen.actor} ${hm(chosen.observedAt)}），锁定结论按基线 r${batch.value.revision} 生效`,
      baselineRevision: batch.value.revision,
      source: '站内',
    })
    return { ok: true, message: '裁决完成，锁定结论已生效' }
  }

  /** 值班负责人对依据失效的许可重新复核，许可阶段重算 */
  function reconfirm(permitId: string) {
    const permit = findPermit(permitId)
    if (!permit || !permit.invalidated) return { ok: false, message: '该许可无需重算复核' }
    const reason = permit.invalidated.reason
    reconfirmPermit(permit, batch.value.revision)
    addAudit({
      opNo: nextOpNo(),
      batchId: permit.batchId,
      device: permit.device,
      actor: '值班负责人',
      action: '依据重算复核',
      target: permit.id,
      detail: `${reason}后已重新确认隔离边界与现场条件，许可重新进入流程，基线 r${batch.value.revision}`,
      baselineRevision: batch.value.revision,
      source: '站内',
    })
    return { ok: true, message: '重算复核通过' }
  }

  // ---- 基线变化：风速 / 设备编号 / 母线边界 -------------------------------

  function applyBasisChange(reason: InvalidationReason, detail: string, opts: { device?: string; permitId?: string; oldBoundary?: string } = {}) {
    const at = clockNow()
    const affected = invalidateForBasisChange(batch.value, permits.value, {
      reason,
      at,
      device: opts.device,
      permitId: opts.permitId,
      oldBoundary: opts.oldBoundary,
    })
    const opNo = nextOpNo()
    addAudit({
      opNo,
      batchId: batch.value.id,
      actor: '值班负责人',
      action: `基线变更·${reason}`,
      target: reason === '设备编号变更' ? opts.device ?? '' : reason === '母线边界变更' ? `${opts.oldBoundary} → ${batch.value.busBoundary}` : '现场条件',
      detail: `${detail}；批次基线升至 r${batch.value.revision}，相关锁定结论与许可阶段失效重算，其他许可沿用`,
      baselineRevision: batch.value.revision,
      source: '站内',
    })
    affected.forEach((permit, index) => {
      addAudit({
        opNo: `${opNo}-P${index + 1}`,
        batchId: batch.value.id,
        device: permit.device,
        actor: '系统',
        action: '许可失效重算',
        target: permit.id,
        detail: `${permit.id} 受${reason}影响退回「待复核」`,
        baselineRevision: batch.value.revision,
        source: '站内',
      })
    })
    latestAlert.value = `${reason}：${affected.length} 份许可的锁定结论与阶段已失效，等待重新复核`
    return affected.map((permit) => permit.id)
  }

  function setWindSpeed(value: number) {
    const previous = batch.value.windSpeed
    batch.value.windSpeed = value
    const affected = applyBasisChange('风速变化', `轮毂高度风速 ${previous}m/s → ${value}m/s${value >= WIND_SUSPEND_LIMIT ? '，达到高空作业暂停阈值' : ''}`)
    return affected
  }
  function setBusBoundary(next: string) {
    const oldBoundary = batch.value.busBoundary
    if (next === oldBoundary) return [] as string[]
    batch.value.busBoundary = next
    return applyBasisChange('母线边界变更', `母线停电边界 ${oldBoundary} → ${next}`, { oldBoundary })
  }
  function renameDevice(permitId: string, oldCode: string, newCode: string) {
    const permit = findPermit(permitId)
    if (!permit || !oldCode.trim() || !newCode.trim() || oldCode === newCode) return [] as string[]
    // 先重编号该设备下的隔离点，再按新编号让相关锁定结论失效
    permit.isolationPoints.forEach((point) => {
      if (point.device === oldCode) point.device = newCode
    })
    if (permit.device.includes(oldCode)) permit.device = permit.device.split(oldCode).join(newCode)
    const affected = applyBasisChange('设备编号变更', `${permit.id} 设备编号 ${oldCode} → ${newCode}`, { device: newCode, permitId: permit.id })
    return affected
  }

  // ---- 断网 / 补录 / 检查点重试 ------------------------------------------

  function queueOffline(record: Omit<OfflineRecord, 'id' | 'opNo' | 'occurredAt' | 'applied'>) {
    const occurredAt = clockNow()
    const opNo = nextOpNo()
    const item: OfflineRecord = { ...record, id: opNo, opNo, occurredAt, applied: false }
    outbox.value.unshift(item)
    addAudit({
      opNo: `${opNo}-Q`,
      batchId: record.batchId,
      device: record.device,
      actor: record.actor,
      action: '断网暂存',
      target: record.targetId,
      detail: `塔基无网，操作号 ${opNo} 已写入待补录队列（发生时间 ${hm(occurredAt)}）`,
      baselineRevision: record.baselineRevision,
      source: '现场',
    })
    return opNo
  }

  function goOffline() {
    connection.value = '塔基断网'
    addAudit({
      opNo: nextOpNo(),
      batchId: batch.value.id,
      actor: '系统',
      action: '通道状态',
      target: '塔基网络',
      detail: '塔基失去网络，现场断电与机械锁定操作进入本地暂存',
      baselineRevision: batch.value.revision,
      source: '现场',
    })
  }
  function goReconnecting() {
    if (connection.value === '塔基断网') connection.value = '重连中'
  }

  /**
   * 回网补录：从最后完整检查点之后重放；同号操作幂等，不再多生成审计。
   * 第一次调用可注入失败，以演示失败后从检查点重试。
   */
  function syncOffline(options: { failFirst?: boolean } = {}) {
    if (!outbox.value.some((record) => !record.applied)) {
      syncState.value = { status: 'idle', message: '没有待补录记录' }
      return syncState.value
    }
    connection.value = '重连中'

    if (options.failFirst) {
      syncState.value = { status: 'failed', message: '补录失败：网络中断，已保留最后完整检查点，可直接重试' }
      connection.value = '塔基断网'
      addAudit({
        opNo: nextOpNo(),
        batchId: batch.value.id,
        actor: '系统',
        action: '补录失败',
        target: '回网通道',
        detail: `失败停在检查点${checkpoint.value ? `（${hm(checkpoint.value.at)}，已入库 ${checkpoint.value.appliedOpNos.length} 项）` : '（尚无完整检查点）'}，未提交的操作号不会重复生成审计`,
        baselineRevision: batch.value.revision,
        source: '站内',
      })
      persist()
      return syncState.value
    }

    const alreadyApplied = new Set([...appliedOpNos.value, ...(checkpoint.value?.appliedOpNos ?? [])])
    const result = mergeOfflineRecords({
      permits: permits.value,
      audit: audit.value,
      records: outbox.value,
      appliedOpNos: alreadyApplied,
    })

    // 按发生顺序标记已应用（幂等键即操作号）
    const appliedSet = new Set(result.appliedOpNos)
    outbox.value.forEach((record) => {
      if (appliedSet.has(record.opNo)) record.applied = true
    })
    audit.value = result.audit
    permits.value = result.permits
    appliedOpNos.value = [...new Set([...appliedOpNos.value, ...result.appliedOpNos])]
    checkpoint.value = {
      at: clockNow(),
      appliedOpNos: [...new Set([...(checkpoint.value?.appliedOpNos ?? []), ...result.appliedOpNos])],
    }

    result.conflicts.forEach(({ permitId, pointId }) => {
      const permit = findPermit(permitId)
      const point = permit?.isolationPoints.find((item) => item.id === pointId)
      if (permit && point) permit.reviewRequired = true
    })

    connection.value = '在线'
    syncState.value = {
      status: 'success',
      message: `补录完成：按项合并 ${result.appliedOpNos.length} 项${result.conflicts.length ? `，${result.conflicts.length} 个锁定点双值待裁决` : ''}`,
    }
    if (result.appliedOpNos.length) {
      latestAlert.value = result.conflicts.length
        ? '断网记录已按操作号合并：叶轮机械锁/箱变低压侧刀闸存在双份现场值，待值班负责人裁决'
        : '断网记录已按操作号合并入库，同号操作未重复生成审计'
    }
    addAudit({
      opNo: nextOpNo(),
      batchId: batch.value.id,
      actor: '系统',
      action: '补录检查点',
      target: '回网通道',
      detail: `检查点推进：本次入库操作号 ${result.appliedOpNos.join('、') || '无新项'}；共 ${checkpoint.value.appliedOpNos.length} 项已确认`,
      baselineRevision: batch.value.revision,
      source: '站内',
    })
    persist()
    return syncState.value
  }

  function retryPending() {
    return syncOffline()
  }

  /** 现场模拟：一键产生若干断网记录（含双份现场值冲突） */
  function simulateFieldworkOffline() {
    const permit = findPermit('WP-260929-018')
    if (!permit) return
    const base = new Date()
    const mk = (offsetSeconds: number, record: Omit<OfflineRecord, 'id' | 'opNo' | 'occurredAt' | 'applied'>) => {
      const occurredAt = new Date(base.getTime() + offsetSeconds * 1000).toISOString()
      const opNo = nextOpNo()
      outbox.value.unshift({ ...record, id: opNo, opNo, occurredAt, applied: false })
    }
    mk(0, { batchId: permit.batchId, permitId: permit.id, device: 'WTG-03', kind: 'step-toggle', targetId: 'ST-03', actor: '何岚', baselineRevision: permit.baselineRevision, done: true })
    mk(45, { batchId: permit.batchId, permitId: permit.id, device: 'BOX-03', kind: 'field-value', targetId: 'IP-302', actor: '周野', baselineRevision: permit.baselineRevision, value: '拉开并加挂锁 LK-2107' })
    mk(90, { batchId: permit.batchId, permitId: permit.id, device: 'WTG-03', kind: 'field-value', targetId: 'IP-303', actor: '周野', baselineRevision: permit.baselineRevision, value: '已入锁位 A（锁销到位）' })
    mk(130, { batchId: permit.batchId, permitId: permit.id, device: 'WTG-03', kind: 'field-value', targetId: 'IP-303', actor: '何岚', baselineRevision: permit.baselineRevision, value: '锁销未到位（约 20mm 间隙）' })
    mk(200, { batchId: permit.batchId, permitId: permit.id, device: 'WTG-03', kind: 'step-toggle', targetId: 'ST-04', actor: '李骁', baselineRevision: permit.baselineRevision, done: true })
    persist()
  }

  function addPermit(permit: Permit) {
    permits.value.unshift(permit)
    batch.value.permitIds.unshift(permit.id)
    addAudit({
      opNo: permit.opNo,
      batchId: permit.batchId,
      device: permit.device,
      actor: '当前用户',
      action: '新建许可',
      target: permit.id,
      detail: `${permit.title}，基线修订 r${permit.baselineRevision}`,
      baselineRevision: permit.baselineRevision,
      source: '站内',
    })
  }

  function acceptAlert() {
    latestAlert.value = ''
  }

  restore()
  return {
    batches,
    batch,
    permits,
    audit,
    outbox,
    connection,
    checkpoint,
    syncState,
    pendingRetry,
    conflictPermits,
    latestAlert,
    WIND_SUSPEND_LIMIT,
    nextOpNo,
    advancePermit,
    toggleStep,
    submitFieldValue,
    adjudicate,
    reconfirm,
    setWindSpeed,
    setBusBoundary,
    renameDevice,
    addPermit,
    acceptAlert,
    goOffline,
    goReconnecting,
    syncOffline,
    retryPending,
    simulateFieldworkOffline,
    restore,
  }
})
