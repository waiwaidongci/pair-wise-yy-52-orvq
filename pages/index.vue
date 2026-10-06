<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'

const store = useOperationsStore()
const toast = useToast()
const { data } = await useFetch('/api/operations')
useRealtime((event) => {
  if (event.type === 'connection') store.connection = event.payload.startsWith('在线') ? '在线' : '重连中'
  if (event.type === 'permit-update') store.latestAlert = event.payload
})
const counts = computed(() => ({
  active: store.permits.filter((item) => ['执行中', '待结束'].includes(item.status)).length,
  pending: store.permits.filter((item) => ['待复核', '待执行'].includes(item.status)).length,
  conflicts: store.conflictPermits.length,
}))

const windDraft = ref(store.batch.windSpeed)
const boundaryDraft = ref(store.batch.busBoundary)
const deviceOld = ref('WTG-03')
const deviceNew = ref('WTG-03A')

function notify(result: { ok?: boolean; message: string }) {
  toast.add({ title: result.ok ? '操作成功' : '提示', description: result.message, color: result.ok ? 'success' : 'amber' })
}
function applyWind() {
  if (Number(windDraft.value) === store.batch.windSpeed) return
  const affected = store.setWindSpeed(Number(windDraft.value))
  toast.add({ title: '风速基线变更', description: `${affected.length} 份许可失效重算，其余沿用`, color: 'red' })
}
function applyBoundary() {
  if (boundaryDraft.value === store.batch.busBoundary) return
  const affected = store.setBusBoundary(boundaryDraft.value)
  toast.add({ title: '母线边界变更', description: `${affected.length} 份许可退回待复核，其余沿用`, color: 'red' })
}
function renameDevice() {
  if (!deviceOld.value.trim() || !deviceNew.value.trim()) return
  const affected = store.renameDevice('WP-260929-018', deviceOld.value.trim(), deviceNew.value.trim())
  if (affected.length) toast.add({ title: '设备编号变更', description: `${affected.length} 份许可失效重算`, color: 'red' })
}
function goOffline() {
  store.goOffline()
  toast.add({ title: '塔基断网', description: '此后现场断电/机械锁定将本地暂存，回站后按操作号补录', color: 'amber' })
}
function stageFieldwork() {
  if (store.connection === '在线') goOffline()
  store.simulateFieldworkOffline()
  toast.add({ title: '已写入本地待补录队列', description: '含验电步骤、箱变刀闸读数与叶轮机械锁双份现场值（按发生时间排序）', color: 'amber' })
}
function syncFailFirst() {
  const state = store.syncOffline({ failFirst: true })
  toast.add({ title: '补录失败', description: state.message, color: 'red' })
}
function retry() {
  const state = store.retryPending()
  toast.add({ title: state.status === 'success' ? '从检查点补录成功' : '提示', description: state.message, color: state.status === 'success' ? 'success' : 'amber' })
}
</script>

<template>
  <div class="page">
    <div class="head">
      <div><p class="eyebrow">现场安全运行 · 批次 {{ store.batch.id }}</p><h1 class="page-title">隔离与作业许可总览</h1><p class="muted">许可、隔离点、步骤与审计同属一个检修批次，每项带操作号 / 设备编号 / 基线修订 / 发生时间。</p></div>
      <div class="inline wrap"><UButton color="gray" variant="outline" icon="i-heroicons-arrow-path">检查连接</UButton><UButton color="primary" icon="i-heroicons-document-plus" @click="navigateTo('/permits?new=1')">申请作业许可</UButton></div>
    </div>

    <UAlert v-if="store.latestAlert" class="mb-4" color="amber" variant="soft" icon="i-heroicons-exclamation-triangle" title="实时冲突提醒" :description="store.latestAlert" :actions="[{ label: '知道了', click: store.acceptAlert }]" />

    <!-- 基线控制：风速 / 设备编号 / 母线边界，一改即失效重算 -->
    <section class="panel basis-bar mb-4">
      <div class="basis-title"><b>批次基线 r{{ store.batch.revision }}</b><small>三类依据任一改变，相关锁定结论与许可阶段失效重算，其他许可沿用</small></div>
      <div class="basis-controls">
        <label>轮毂风速<UInput v-model="windDraft" type="number" size="sm" class="num" /><span>m/s</span><UButton size="xs" @click="applyWind">变更风速</UButton></label>
        <label>设备编号<UInput v-model="deviceOld" size="sm" class="code" /><span>→</span><UInput v-model="deviceNew" size="sm" class="code" /><UButton size="xs" @click="renameDevice">改编号</UButton></label>
        <label>母线边界<UInput v-model="boundaryDraft" size="sm" class="dev" /><UButton size="xs" @click="applyBoundary">改边界</UButton></label>
      </div>
    </section>

    <!-- 断网补录 / 检查点重试 -->
    <section class="panel sync-bar mb-4">
      <div class="sync-left"><UBadge :color="store.connection === '在线' ? 'green' : store.connection === '重连中' ? 'amber' : 'red'" variant="subtle" size="lg" icon="i-heroicons-wifi">{{ store.connection }}</UBadge>
        <div><b>塔基无网作业 → 回站补录</b><small>断网记录本地暂存；回网按项合并，同号操作幂等；失败后从最后完整检查点重试。</small></div>
      </div>
      <div class="inline wrap">
        <UButton size="sm" color="gray" variant="outline" icon="i-heroicons-signal-slash" :disabled="store.connection !== '在线'" @click="goOffline">模拟塔基断网</UButton>
        <UButton size="sm" color="amber" variant="outline" icon="i-heroicons-wrench-screwdriver" @click="stageFieldwork">产生现场断电/锁定记录</UButton>
        <UButton size="sm" color="red" variant="soft" icon="i-heroicons-arrow-up-on-square-stack" :disabled="!store.pendingRetry" @click="syncFailFirst">回网补录（首次失败）</UButton>
        <UButton size="sm" color="primary" icon="i-heroicons-arrow-path" :disabled="!store.pendingRetry" @click="retry">从检查点重试 ({{ store.pendingRetry }})</UButton>
      </div>
    </section>

    <section class="grid metrics">
      <article class="panel metric"><span>执行中许可</span><strong>{{ counts.active }}</strong><small>3 个班组在场</small></article>
      <article class="panel metric"><span>待复核 / 待执行</span><strong>{{ counts.pending }}</strong><small>最早 18:00 开工</small></article>
      <article class="panel metric"><span>待裁决 / 失效重算</span><strong class="danger">{{ counts.conflicts }}</strong><small>值班负责人处理后推进</small></article>
      <article class="panel metric"><span>设备在线</span><strong>{{ data?.onlineDevices }}/{{ data?.totalDevices }}</strong><small>批次风速 {{ store.batch.windSpeed }} m/s</small></article>
    </section>
    <section class="grid main-grid">
      <article class="panel p-4">
        <div class="panel-head"><div><h2>当前作业状态</h2><p class="muted">同一检修批次，按风险和开始时间排序</p></div><UBadge color="blue" variant="subtle">批次 {{ store.batch.id }}</UBadge></div>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>许可 / 作业</th><th>操作号 · 设备</th><th>负责人</th><th>状态</th><th></th></tr></thead><tbody>
          <tr v-for="permit in store.permits" :key="permit.id"><td><b>{{ permit.id }}</b><small class="block muted">{{ permit.title }} · r{{ permit.revision }}</small></td><td><span class="mono">{{ permit.opNo }}</span><small class="block muted">{{ permit.device }}</small></td><td>{{ permit.owner }} · {{ permit.crew }}</td><td><UBadge :color="permit.invalidated ? 'red' : permit.isolationPoints.some((p) => p.lockConclusion === '待裁决') ? 'red' : permit.status === '执行中' ? 'green' : 'amber'" variant="subtle">{{ permit.invalidated ? `失效·${permit.invalidated.reason}` : permit.isolationPoints.some((p) => p.lockConclusion === '待裁决') ? '双值待裁决' : permit.status }}</UBadge></td><td><UButton size="xs" variant="ghost" @click="navigateTo(`/permits?id=${permit.id}`)">进入</UButton></td></tr>
        </tbody></table></div>
      </article>
      <aside class="grid side-grid">
        <article class="panel p-4"><h2>待值班负责人处理</h2>
          <div v-if="!store.conflictPermits.length" class="empty">暂无待裁决项</div>
          <div v-for="permit in store.conflictPermits" :key="permit.id" class="conflict-row">
            <b>{{ permit.id }}</b>
            <UBadge v-if="permit.invalidated" size="xs" color="red" variant="subtle">{{ permit.invalidated.reason }}·退回待复核</UBadge>
            <UBadge v-for="point in permit.isolationPoints.filter((p) => p.lockConclusion === '待裁决')" :key="point.id" size="xs" color="amber" variant="subtle">{{ point.label }} 双值</UBadge>
            <UButton size="xs" variant="ghost" @click="navigateTo(`/permits?id=${permit.id}`)">去裁决</UButton>
          </div>
        </article>
        <article class="panel p-4"><h2>现场条件 / 补录检查点</h2>
          <div class="condition"><span>轮毂高度风速</span><b :class="{ danger: store.batch.windSpeed >= store.WIND_SUSPEND_LIMIT }">{{ store.batch.windSpeed }} m/s</b></div>
          <div class="condition"><span>母线边界</span><b>{{ store.batch.busBoundary }}</b></div>
          <div class="condition"><span>待补录记录</span><b :class="{ warning: store.pendingRetry }">{{ store.pendingRetry }} 项</b></div>
          <div class="condition"><span>最后检查点</span><b>{{ store.checkpoint ? `${store.checkpoint.appliedOpNos.length} 项已确认` : '尚未建立' }}</b></div>
        </article>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}.mb-4{margin-bottom:16px}
.basis-bar{display:flex;align-items:center;gap:18px;padding:14px 16px;flex-wrap:wrap}.basis-title{min-width:230px}.basis-title b,.basis-title small{display:block}.basis-title small{color:#667085;margin-top:3px}.basis-controls{display:flex;gap:18px;flex-wrap:wrap;flex:1}.basis-controls label{display:flex;align-items:center;gap:7px;font-size:13px;color:#475569}.basis-controls .num{width:78px}.basis-controls .dev{width:150px}.basis-controls .code{width:92px}
.sync-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 16px;flex-wrap:wrap}.sync-left{display:flex;align-items:center;gap:12px}.sync-left b,.sync-left small{display:block}.sync-left small{color:#667085;margin-top:2px;font-size:12px}
.metrics{grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.metric{padding:17px}.main-grid{grid-template-columns:minmax(0,1.65fr) minmax(300px,.7fr);gap:16px}.panel-head{display:flex;justify-content:space-between;margin-bottom:12px}.panel h2{font-size:17px;margin:0 0 12px}.panel-head h2{margin:0}.panel-head p{font-size:12px;margin:3px 0}.block,.device-row small{display:block}.side-grid{gap:14px}.condition{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5;font-size:14px}.condition span{color:#667085}.conflict-row{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid #edf0f5;flex-wrap:wrap}.conflict-row b{flex:1}.empty{color:#94a3b8;font-size:13px;padding:8px 0}
@media(max-width:1100px){.metrics{grid-template-columns:1fr 1fr}.main-grid{grid-template-columns:1fr}}@media(max-width:620px){.head{flex-direction:column}.metrics{grid-template-columns:1fr}}
</style>
