export type PermitStatus = '待复核' | '待执行' | '执行中' | '待结束' | '待关闭' | '已完成'

export type RecordSource = '站内' | '现场'

export type InvalidationReason = '风速变化' | '设备编号变更' | '母线边界变更'

/** 同一隔离点出现多份现场读数时留存的值 */
export interface FieldValue {
  id: string
  value: string
  actor: string
  observedAt: string
  source: RecordSource
}

export interface IsolationPoint {
  id: string
  /** 操作号 */
  opNo: string
  /** 设备编号 */
  device: string
  label: string
  type: '开关' | '刀闸' | '阀门' | '接地'
  state: '已隔离' | '待操作' | '已恢复'
  /** 基线修订：该结论所依据的批次修订 */
  baselineRevision: number
  /** 发生时间 */
  occurredAt: string
  /** 现场回传值（机械锁位置 / 刀闸位置等） */
  fieldValues: FieldValue[]
  /** 锁定结论：有效 / 待值班负责人裁决 / 依据失效需重算 */
  lockConclusion: '有效' | '待裁决' | '失效'
  /** 裁决采纳的现场值 id */
  adjudgedValueId?: string
}

export interface PermitStep {
  id: string
  opNo: string
  device: string
  text: string
  done: boolean
  owner: string
  evidence?: string
  baselineRevision: number
  occurredAt: string
}

export interface PermitBasis {
  /** 许可结论依据的风速 m/s */
  windSpeed: number
  /** 许可主设备编号 */
  device: string
  /** 母线边界编号 */
  busBoundary: string
}

export interface Permit {
  id: string
  title: string
  device: string
  crew: string
  owner: string
  window: string
  status: PermitStatus
  risk: '一级' | '二级' | '三级'
  isolationPoints: IsolationPoint[]
  steps: PermitStep[]
  revision: number
  reviewRequired: boolean
  /** 所属检修批次 */
  batchId: string
  /** 许可自身的操作号 */
  opNo: string
  baselineRevision: number
  occurredAt: string
  /** 许可结论依据 */
  basis: PermitBasis
  /** 依据变化后被判定失效，需重算 */
  invalidated?: { reason: InvalidationReason; at: string; fromRevision: number } | null
}

export interface AuditEvent {
  id: string
  /** 同号操作全局只保留一条审计 */
  opNo: string
  batchId?: string
  device?: string
  /** 展示用时间 */
  time: string
  /** 实际发生时间，断网补录按它排序 */
  occurredAt: string
  actor: string
  action: string
  target: string
  detail: string
  baselineRevision: number
  source: RecordSource
  /** 断网回网后按项合并而来 */
  merged?: boolean
}

export type OfflineKind = 'step-toggle' | 'field-value' | 'permit-advance'

/** 塔基断网期间产生、回站后补录的现场记录 */
export interface OfflineRecord {
  id: string
  opNo: string
  batchId: string
  permitId: string
  device: string
  kind: OfflineKind
  targetId: string
  occurredAt: string
  actor: string
  baselineRevision: number
  value?: string
  done?: boolean
  note?: string
  applied: boolean
}

export interface MaintenanceBatch {
  id: string
  title: string
  createdAt: string
  /** 批次基线修订，边界/风速每改一次 +1 */
  revision: number
  windSpeed: number
  busBoundary: string
  permitIds: string[]
}

/** 补录检查点：该操作号之前的记录都已完整入库 */
export interface SyncCheckpoint {
  at: string
  appliedOpNos: string[]
}
