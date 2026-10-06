export type PermitStatus = '待复核' | '待执行' | '执行中' | '待结束' | '待关闭' | '已完成'

export interface IsolationPoint {
  id: string
  device: string
  label: string
  type: '开关' | '刀闸' | '阀门' | '接地'
  state: '已隔离' | '待操作' | '已恢复'
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
  steps: { id: string; text: string; done: boolean; owner: string; evidence?: string }[]
  revision: number
  reviewRequired: boolean
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
}

// —— 检修批次：把作业许可、隔离点、操作步骤、审计记录接成同一份批次 ——

export type BatchSource = '断网补录' | '在线操作' | '旧草稿升级'
export type BatchStatus = '待合并' | '已合并' | '部分失败' | '待裁决' | '待复核'
export type OpKind = '许可' | '隔离点' | '步骤' | '审计'

export interface BatchOperation {
  opNo: string                 // 操作号（幂等键，同号操作不再多生成审计）
  kind: OpKind
  targetId: string             // 操作对象：许可号 / 隔离点号 / 步骤号
  device: string               // 设备编号
  baselineRevision: number     // 基线修订：操作发生时所依据的许可修订
  occurredAt: string           // 发生时间（ISO 时间戳）
  actor: string
  action: string
  detail: string
  fieldValue?: IsolationPoint['state']  // 隔离点现场值（仅隔离点操作）
  done?: boolean               // 步骤目标态（仅步骤操作）
  merged: boolean
  conflict: boolean            // 两份现场值冲突，留待值班负责人裁决
  invalidated: boolean         // 风速/设备编号/母线边界变化导致结论失效
  auditId?: string              // 已生成的审计记录（幂等）
}

export interface MaintenanceBatch {
  id: string                   // 批次号
  source: BatchSource
  status: BatchStatus
  createdAt: string
  checkpoint: number           // 最后完整检查点（已合并到的操作序号，-1 尚未开始）
  failure?: string             // 补录失败原因
  ops: BatchOperation[]
}
