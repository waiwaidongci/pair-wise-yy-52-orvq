<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'
import type { BatchStatus, MaintenanceBatch } from '~/types'

const store = useOperationsStore()

const windSpeed = ref(10.8)
const deviceNo = ref('')
const busbar = ref('')
const failAt = ref(true)

const pendingOffline = computed(() => store.batches.find((b) => b.source === '断网补录' && b.status === '待合并'))

function statusColor(status: BatchStatus) {
  const map: Record<BatchStatus, 'amber' | 'green' | 'red' | 'orange' | 'blue'> = { 待合并: 'amber', 已合并: 'green', 部分失败: 'red', 待裁决: 'orange', 待复核: 'blue' }
  return map[status]
}
function opStatus(op: { merged: boolean; conflict: boolean; invalidated: boolean }) {
  if (op.conflict) return { text: '待裁决', color: 'orange' as const }
  if (op.invalidated) return { text: '已失效', color: 'red' as const }
  if (op.merged) return { text: '已合并', color: 'green' as const }
  return { text: '待合并', color: 'amber' as const }
}
function progress(batch: MaintenanceBatch) {
  const done = batch.ops.filter((o) => o.merged).length
  return Math.round(done / batch.ops.length * 100)
}
function applyWind() { store.invalidateContext({ windSpeed: windSpeed.value }) }
function applyDevice() { if (deviceNo.value.trim()) store.invalidateContext({ device: deviceNo.value.trim() }) }
function applyBusbar() { if (busbar.value.trim()) store.invalidateContext({ busbar: busbar.value.trim() }) }
</script>

<template>
  <div class="page">
    <div class="head">
      <div><p class="eyebrow">断网补录 · 按项合并</p><h1 class="page-title">检修批次</h1><p class="muted">把作业许可、隔离点、操作步骤和审计记录接成同一份批次：每项带操作号、设备编号、基线修订和发生时间，回网后按项合并。</p></div>
      <div class="inline wrap">
        <UButton color="gray" variant="outline" icon="i-heroicons-cloud" @click="store.simulateOfflineShift">模拟断网现场作业</UButton>
        <UButton v-if="pendingOffline" color="primary" icon="i-heroicons-arrow-path" @click="store.backfillOffline(pendingOffline.id, failAt ? { failAt: 2 } : {})">回站补录</UButton>
        <UButton color="blue" variant="soft" icon="i-heroicons-document-duplicate" @click="store.upgradeDrafts()">旧草稿升级</UButton>
      </div>
    </div>

    <UAlert type="warning" class="mb-4" title="后交操作不得把已复核许可拉回旧状态" description="断网记录回网后按操作号逐项合并：未碰同一项的按发生顺序补入库；叶轮机械锁或箱变低压侧刀闸有两份现场值时留待值班负责人裁决；补录失败从最后完整检查点重试，同号操作不再多生成审计。" />

    <section class="grid ctx-grid">
      <article class="panel p-4">
        <h2>上下文失效重算</h2>
        <p class="muted">风速、设备编号或母线边界一改，相关锁定结论和许可阶段失效重算，其他许可沿用。</p>
        <div class="ctx-row"><label>轮毂高度风速 (m/s)</label><div class="inline"><UInput v-model.number="windSpeed" type="number" step="0.1" class="w-28" /><UButton size="sm" @click="applyWind">应用</UButton></div></div>
        <div class="ctx-row"><label>设备编号</label><div class="inline"><UInput v-model="deviceNo" placeholder="如 WTG-03" class="w-40" /><UButton size="sm" @click="applyDevice">应用</UButton></div></div>
        <div class="ctx-row"><label>母线边界</label><div class="inline"><UInput v-model="busbar" placeholder="如 BUS-A" class="w-40" /><UButton size="sm" @click="applyBusbar">应用</UButton></div></div>
      </article>
      <article class="panel p-4">
        <h2>补录检查点</h2>
        <div class="inline wrap mb-3"><UToggle v-model="failAt" /><span class="muted">模拟第 3 项补录中断（现场连接瞬断）</span></div>
        <div class="checkpoint-legend"><span><i class="dot green" />已合并</span><span><i class="dot amber" />待合并</span><span><i class="dot red" />失败/失效</span><span><i class="dot orange" />待裁决</span></div>
        <p class="muted">补录逐项推进，每完成一项记录检查点；失败后从最后完整检查点重试，已合并项不重复生成审计。</p>
      </article>
    </section>

    <section v-if="!store.batches.length" class="panel p-4 empty">
      <p class="muted">暂无检修批次。点击「模拟断网现场作业」生成一份断网补录批次，或「旧草稿升级」把缺操作号的草稿升级为待复核批次。</p>
    </section>

    <section v-for="batch in store.batches" :key="batch.id" class="panel batch">
      <div class="batch-head">
        <div class="inline wrap">
          <b class="batch-id">{{ batch.id }}</b>
          <UBadge size="xs" variant="subtle" color="gray">{{ batch.source }}</UBadge>
          <UBadge size="xs" variant="subtle" :color="statusColor(batch.status)">{{ batch.status }}</UBadge>
        </div>
        <div class="inline wrap">
          <span class="muted">检查点 {{ batch.checkpoint + 1 }}/{{ batch.ops.length }}</span>
          <UProgress :value="progress(batch)" class="batch-progress" />
          <UButton v-if="batch.status === '部分失败'" size="xs" color="amber" icon="i-heroicons-arrow-path" @click="store.retryBatch(batch.id)">从检查点重试</UButton>
        </div>
      </div>
      <p v-if="batch.failure" class="failure">失败原因：{{ batch.failure }}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>操作号</th><th>类型</th><th>操作对象</th><th>设备编号</th><th>基线修订</th><th>发生时间</th><th>现场值</th><th>状态</th><th></th></tr></thead>
          <tbody>
            <tr v-for="op in batch.ops" :key="op.opNo">
              <td class="mono">{{ op.opNo }}</td>
              <td>{{ op.kind }}</td>
              <td class="mono">{{ op.targetId }}</td>
              <td>{{ op.device }}</td>
              <td>r{{ op.baselineRevision }}</td>
              <td class="mono time">{{ op.occurredAt }}</td>
              <td>{{ op.fieldValue ?? (op.done !== undefined ? (op.done ? '完成' : '撤销') : '—') }}</td>
              <td><UBadge size="xs" variant="subtle" :color="opStatus(op).color">{{ opStatus(op).text }}</UBadge></td>
              <td>
                <div v-if="op.conflict" class="inline">
                  <UButton size="xs" color="green" variant="soft" @click="store.adjudicate(batch.id, op.opNo, '维持在线')">维持在线</UButton>
                  <UButton size="xs" color="amber" variant="soft" @click="store.adjudicate(batch.id, op.opNo, '采用现场')">采用现场</UButton>
                  <UButton size="xs" color="gray" variant="ghost" @click="store.adjudicate(batch.id, op.opNo, '重新确认')">重新确认</UButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}
.ctx-grid{grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px}.ctx-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #edf0f5}.ctx-row label{font-size:14px;color:#334155}
.checkpoint-legend{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0}.checkpoint-legend span{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#475569}.dot{width:9px;height:9px;border-radius:50%;display:inline-block}.dot.green{background:#22c55e}.dot.amber{background:#f59e0b}.dot.red{background:#ef4444}.dot.orange{background:#f97316}
.batch{padding:16px;margin-bottom:14px}.batch-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}.batch-id{font-family:monospace;font-size:15px}.batch-progress{width:140px}.failure{color:#dc2626;font-size:13px;margin:0 0 10px}.mono{font-family:monospace;font-size:12px}.time{font-size:11px;color:#64748b}.empty{padding:28px;text-align:center}
@media(max-width:900px){.ctx-grid{grid-template-columns:1fr}}
</style>
