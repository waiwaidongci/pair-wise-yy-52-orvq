import type {
  AuditEvent,
  FieldValue,
  InvalidationReason,
  IsolationPoint,
  MaintenanceBatch,
  OfflineRecord,
  Permit,
} from '~/types'

/** 需要值班负责人裁决双份现场值的隔离点标签 */
const ADJUDICABLE_LABELS = ['叶轮机械锁', '箱变低压侧刀闸']

export function isAdjudicable(point: Pick<IsolationPoint, 'label'>) {
  return ADJUDICABLE_LABELS.some((label) => point.label.includes(label))
}

/** 已裁决或已有两份不一致现场值的关键锁定点 */
export function hasPendingConflict(point: IsolationPoint) {
  return point.lockConclusion === '待裁决'
}

export function distinctFieldValues(point: IsolationPoint) {
  return [...new Set(point.fieldValues.map((item) => item.value))]
}

/** 追加一份现场读数：同操作号合并（幂等），关键点位出现两份不同值时待裁决 */
export function appendFieldValue(point: IsolationPoint, entry: FieldValue): 'duplicate' | 'merged' | 'conflict' | 'new' {
  if (point.fieldValues.some((item) => item.id === entry.id)) return 'duplicate'
  const existed = point.fieldValues.length > 0
  const sameValue = existed && point.fieldValues.some((item) => item.value === entry.value)
  point.fieldValues.push({
    id: entry.id,
    value: entry.value,
    actor: entry.actor,
    observedAt: entry.observedAt,
    source: entry.source,
  })
  point.fieldValues.sort((a, b) => a.observedAt.localeCompare(b.observedAt))
  if (!existed) {
    if (!point.adjudgedValueId) point.lockConclusion = '有效'
    return 'new'
  }
  if (sameValue) return 'merged'
  if (isAdjudicable(point) && !point.adjudgedValueId) {
    point.lockConclusion = '待裁决'
    return 'conflict'
  }
  return 'merged'
}

export function adjudicatePoint(point: IsolationPoint, valueId: string, baselineRevision: number) {
  if (!point.fieldValues.some((item) => item.id === valueId)) return false
  point.adjudgedValueId = valueId
  point.lockConclusion = '有效'
  point.baselineRevision = baselineRevision
  return true
}

const FLOW: Record<Permit['status'], Permit['status'] | undefined> = {
  待复核: '待执行',
  待执行: '执行中',
  执行中: '待结束',
  待结束: '待关闭',
  待关闭: '已完成',
  已完成: undefined,
}

export function nextStatus(status: Permit['status']) {
  return FLOW[status]
}

export function permitBlocked(permit: Permit): string | null {
  if (permit.invalidated) return `许可依据已随${permit.invalidated.reason}失效，需重算后重新复核`
  const conflict = permit.isolationPoints.find(hasPendingConflict)
  if (conflict) return `「${conflict.label}」存在两份现场值，需值班负责人裁决`
  const failed = permit.isolationPoints.find((point) => point.lockConclusion === '失效')
  if (failed) return `「${failed.label}」锁定结论已失效，需重新确认`
  return null
}

/** 设备/风速/边界变化后，相关锁定结论失效、许可阶段回到待复核；其他许可沿用 */
export function invalidateForBasisChange(
  batch: MaintenanceBatch,
  permits: Permit[],
  change: { reason: InvalidationReason; at: string; device?: string; permitId?: string; oldBoundary?: string },
) {
  batch.revision += 1
  const auditPermits: Permit[] = []
  for (const permit of permits) {
    if (!batch.permitIds.includes(permit.id)) continue
    const isRenamedPermit = change.reason === '设备编号变更' && change.permitId === permit.id
    const affectedPoints = permit.isolationPoints.filter((point) => {
      if (change.reason === '风速变化') return point.label.includes('叶轮机械锁')
      if (change.reason === '设备编号变更') return isRenamedPermit || point.device === change.device
      return permit.basis.busBoundary === change.oldBoundary
    })
    const affected =
      change.reason === '设备编号变更'
        ? isRenamedPermit || affectedPoints.length > 0
        : change.reason === '风速变化'
          ? affectedPoints.length > 0
          : permit.basis.busBoundary === change.oldBoundary
    if (!affected) continue

    if (change.reason === '风速变化') permit.basis.windSpeed = batch.windSpeed
    if (change.reason === '设备编号变更' && change.device) permit.basis.device = permit.device
    if (change.reason === '母线边界变更') permit.basis.busBoundary = batch.busBoundary

    for (const point of affectedPoints) {
      if (point.lockConclusion !== '待裁决') point.lockConclusion = '失效'
      point.baselineRevision = batch.revision
    }
    permit.invalidated = { reason: change.reason, at: change.at, fromRevision: permit.revision }
    permit.reviewRequired = true
    permit.revision += 1
    permit.baselineRevision = batch.revision
    permit.status = '待复核'
    auditPermits.push(permit)
  }
  return auditPermits
}

/** 值班负责人重新确认后，失效结论按新基线重算为有效 */
export function reconfirmPermit(permit: Permit, baselineRevision: number) {
  permit.isolationPoints.forEach((point) => {
    if (point.lockConclusion === '失效') {
      point.lockConclusion = '有效'
      point.baselineRevision = baselineRevision
    }
  })
  permit.invalidated = null
  permit.reviewRequired = false
  permit.revision += 1
  permit.baselineRevision = baselineRevision
}

export interface MergeInput {
  permits: Permit[]
  audit: AuditEvent[]
  records: OfflineRecord[]
  /** 检查点之前已完整入库的操作号，不再重放 */
  appliedOpNos: Set<string>
}

export interface MergeResult {
  permits: Permit[]
  audit: AuditEvent[]
  appliedOpNos: string[]
  conflicts: { permitId: string; pointId: string }[]
}

/**
 * 断网记录回网后按项合并：
 * - 同操作号不重复入库（检查点 + 审计操作号双保险）
 * - 未碰同一项的记录按发生时间顺序补入库
 * - 关键锁定点两份不一致现场值留待裁决
 */
export function mergeOfflineRecords(input: MergeInput): MergeResult {
  const permits = input.permits
  const audit = [...input.audit]
  const seen = new Set([...input.appliedOpNos, ...audit.map((item) => item.opNo)])
  const pending = input.records
    .filter((record) => !seen.has(record.opNo))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.opNo.localeCompare(b.opNo))

  const appliedOpNos: string[] = []
  const conflicts: { permitId: string; pointId: string }[] = []
  let seq = audit.length + 1

  const pushAudit = (record: OfflineRecord, action: string, target: string, detail: string, baselineRevision: number) => {
    audit.unshift({
      id: `AE-LOG-${String(seq++).padStart(3, '0')}`,
      opNo: record.opNo,
      batchId: record.batchId,
      device: record.device,
      time: record.occurredAt.slice(11, 16),
      occurredAt: record.occurredAt,
      actor: record.actor,
      action,
      target,
      detail,
      baselineRevision,
      source: '现场',
      merged: true,
    })
  }

  for (const record of pending) {
    const permit = permits.find((item) => item.id === record.permitId && item.batchId === record.batchId)
    if (!permit) continue

    if (record.kind === 'step-toggle') {
      const step = permit.steps.find((item) => item.id === record.targetId)
      if (!step) continue
      step.done = record.done ?? !step.done
      step.baselineRevision = record.baselineRevision
      step.occurredAt = record.occurredAt
      pushAudit(
        record,
        step.done ? '完成步骤' : '撤销步骤',
        `${permit.id} / ${record.targetId}`,
        `${step.text}（塔基断网记录回网合并${record.note ? `，${record.note}` : ''}）`,
        record.baselineRevision,
      )
    } else if (record.kind === 'field-value') {
      const point = permit.isolationPoints.find((item) => item.id === record.targetId)
      if (!point) continue
      const outcome = appendFieldValue(point, {
        id: record.id,
        value: record.value ?? '',
        actor: record.actor,
        observedAt: record.occurredAt,
        source: '现场',
      })
      if (outcome === 'duplicate') continue
      point.baselineRevision = record.baselineRevision
      pushAudit(
        record,
        '现场读数补录',
        `${permit.id} / ${record.targetId}`,
        `「${point.label}」现场值：${record.value}${outcome === 'conflict' ? '；两份现场值不一致，留待值班负责人裁决' : ''}`,
        record.baselineRevision,
      )
      if (outcome === 'conflict') conflicts.push({ permitId: permit.id, pointId: point.id })
    } else if (record.kind === 'permit-advance') {
      const next = nextStatus(permit.status)
      if (!next) continue
      const previous = permit.status
      permit.status = next
      permit.revision += 1
      permit.baselineRevision = record.baselineRevision
      pushAudit(record, '流程推进', permit.id, `状态由“${previous}”变更为“${next}”（断网补录）`, record.baselineRevision)
    }

    seen.add(record.opNo)
    appliedOpNos.push(record.opNo)
  }

  return { permits, audit, appliedOpNos, conflicts }
}

/** 旧草稿缺操作号：补齐操作号/基线并升级为待复核批次 */
export function upgradeLegacyDraft(draft: {
  permits?: Array<Partial<Permit> & Record<string, unknown>>
  audit?: AuditEvent[]
}) {
  const batch: MaintenanceBatch = {
    id: 'MB-LEGACY',
    title: '旧草稿升级批次',
    createdAt: new Date().toISOString(),
    revision: 1,
    windSpeed: 10.8,
    busBoundary: 'BUS-A',
    permitIds: [],
  }
  let counter = 1
  const permits: Permit[] = (draft.permits ?? []).map((raw) => {
    const opNo = typeof raw.opNo === 'string' ? raw.opNo : `OP-OLD-${String(counter).padStart(3, '0')}`
    counter += 1
    batch.permitIds.push(raw.id as string)
    const points: IsolationPoint[] = (raw.isolationPoints ?? []).map((point, index) => ({
      ...(point as IsolationPoint),
      opNo: (point as IsolationPoint).opNo ?? `${opNo}-IP${index + 1}`,
      baselineRevision: (point as IsolationPoint).baselineRevision ?? 1,
      occurredAt: (point as IsolationPoint).occurredAt ?? raw.occurredAt ?? new Date().toISOString(),
      fieldValues: (point as IsolationPoint).fieldValues ?? [],
      lockConclusion: (point as IsolationPoint).lockConclusion ?? '有效',
    }))
    const steps = (raw.steps ?? []).map((step, index) => ({
      ...(step as Permit['steps'][number]),
      opNo: (step as { opNo?: string }).opNo ?? `${opNo}-ST${index + 1}`,
      device: (step as { device?: string }).device ?? raw.device ?? '',
      baselineRevision: (step as { baselineRevision?: number }).baselineRevision ?? 1,
      occurredAt: (step as { occurredAt?: string }).occurredAt ?? raw.occurredAt ?? new Date().toISOString(),
    }))
    return {
      ...(raw as Permit),
      opNo,
      batchId: 'MB-LEGACY',
      baselineRevision: typeof raw.baselineRevision === 'number' ? raw.baselineRevision : 1,
      occurredAt: typeof raw.occurredAt === 'string' ? raw.occurredAt : new Date().toISOString(),
      basis: (raw as { basis?: Permit['basis'] }).basis ?? { windSpeed: batch.windSpeed, device: raw.device ?? '', busBoundary: batch.busBoundary },
      isolationPoints: points,
      steps,
      status: '待复核',
      reviewRequired: true,
      revision: typeof raw.revision === 'number' ? raw.revision + 1 : 1,
    }
  })
  return { batch, permits }
}
