<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'
import type { Permit } from '~/types'
import { isAdjudicable } from '~/utils/batch'

const store = useOperationsStore()
const toast = useToast()
const route = useRoute()
const selectedId = ref(String(route.query.id || store.permits[0]?.id))
const modal = ref(route.query.new === '1')
const form = reactive({ title: '', device: '', crew: '电气一班', owner: '孙禾', window: '09-30 08:00 — 12:00', risk: '二级' as Permit['risk'] })
const selected = computed(() => store.permits.find((item) => item.id === selectedId.value) ?? store.permits[0])
const completed = computed(() => selected.value ? Math.round(selected.value.steps.filter((step) => step.done).length / selected.value.steps.length * 100) : 0)
const statusIndex = computed(() => ['待复核', '待执行', '执行中', '待结束', '待关闭', '已完成'].indexOf(selected.value?.status ?? ''))
const fieldDraft = reactive<Record<string, string>>({})

function notify(result: { ok?: boolean; offline?: boolean; conflict?: boolean; message: string }) {
  toast.add({ title: result.ok ? '操作成功' : result.offline ? '已断网暂存' : '操作被拦截', description: result.message, color: result.ok ? 'success' : result.offline ? 'amber' : 'red' })
}
function hm(iso: string) {
  return iso?.slice(11, 16) ?? ''
}

function advance() {
  notify(store.advancePermit(selected.value.id))
}
function toggle(stepId: string) {
  const result = store.toggleStep(selected.value.id, stepId)
  if (result.offline) toast.add({ title: '塔基断网·已本地暂存', description: `操作号 ${result.opNo} 将在回网后按项合并，不会覆盖值班室已复核状态`, color: 'amber' })
}
function submitValue(pointId: string) {
  const value = fieldDraft[pointId]?.trim()
  if (!value) return
  notify(store.submitFieldValue(selected.value.id, pointId, value))
  fieldDraft[pointId] = ''
}
function adjudicate(pointId: string, valueId: string) {
  if (!valueId) return
  notify(store.adjudicate(selected.value.id, pointId, valueId))
}
function reconfirm() {
  notify(store.reconfirm(selected.value.id))
}

function createPermit() {
  if (!form.title.trim() || !form.device.trim()) return
  const now = new Date().toISOString()
  const opNo = store.nextOpNo()
  const permit: Permit = {
    id: `WP-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${String(store.permits.length + 31).padStart(3, '0')}`,
    opNo,
    batchId: store.batch.id,
    baselineRevision: store.batch.revision,
    occurredAt: now,
    ...form,
    status: '待复核',
    revision: 1,
    reviewRequired: true,
    invalidated: null,
    basis: { windSpeed: store.batch.windSpeed, device: form.device, busBoundary: store.batch.busBoundary },
    isolationPoints: [{ id: `IP-${Date.now().toString().slice(-4)}`, opNo: store.nextOpNo(), device: form.device, label: '主隔离点', type: '开关', state: '待操作', baselineRevision: store.batch.revision, occurredAt: now, fieldValues: [], lockConclusion: '有效' }],
    steps: [
      { id: 'ST-31', opNo: store.nextOpNo(), device: form.device, text: '核对设备双重编号与工作范围', done: false, owner: form.owner, baselineRevision: store.batch.revision, occurredAt: now },
      { id: 'ST-32', opNo: store.nextOpNo(), device: form.device, text: '完成隔离、锁定、验电和接地', done: false, owner: form.owner, baselineRevision: store.batch.revision, occurredAt: now },
    ],
  }
  store.addPermit(permit)
  selectedId.value = permit.id
  modal.value = false
}
</script>

<template>
  <div class="page">
    <div class="head"><div><p class="eyebrow">许可全生命周期 · 同一检修批次 {{ store.batch.id }}</p><h1 class="page-title">作业许可证</h1><p class="muted">每项操作都带操作号、设备编号、基线修订与发生时间；断网回网后按操作号合并。</p></div><UButton icon="i-heroicons-plus" color="primary" @click="modal = true">新建许可</UButton></div>
    <div class="permit-layout">
      <aside class="panel permit-list">
        <button v-for="permit in store.permits" :key="permit.id" :class="{ active: permit.id === selectedId }" @click="selectedId = permit.id"><span><b>{{ permit.id }}</b><small>{{ permit.title }} · r{{ permit.revision }}</small></span><UBadge :color="permit.invalidated || permit.isolationPoints.some((point) => point.lockConclusion === '待裁决') ? 'red' : 'amber'" variant="subtle">{{ permit.invalidated ? '依据失效' : permit.isolationPoints.some((point) => point.lockConclusion === '待裁决') ? '待裁决' : permit.status }}</UBadge></button>
      </aside>
      <section v-if="selected" class="grid detail-grid">
        <article class="panel p-4">
          <div class="detail-head"><div><small class="mono muted">{{ selected.opNo }} · 基线 r{{ selected.baselineRevision }} · {{ selected.occurredAt.slice(0, 16).replace('T', ' ') }}</small><h2>{{ selected.title }}</h2><p>{{ selected.device }} · {{ selected.window }} · 母线 {{ selected.basis.busBoundary }} · 依据风速 {{ selected.basis.windSpeed }} m/s</p></div><UBadge size="lg" :color="selected.invalidated ? 'red' : selected.reviewRequired ? 'amber' : 'green'" variant="subtle">{{ selected.invalidated ? `失效·${selected.invalidated.reason}` : selected.status }}</UBadge></div>
          <div class="flow"><div v-for="(step,index) in ['申请','复核','执行','结束','关闭']" :key="step" :class="{ done: index <= statusIndex, current: index === statusIndex }"><i>{{ index + 1 }}</i><span>{{ step }}</span></div></div>
          <UAlert v-if="selected.invalidated" color="red" variant="soft" :title="`${selected.invalidated.reason}，锁定结论与许可阶段已失效`" description="依据变化后该许可已退回待复核，其他许可不受影响；值班负责人重新确认隔离边界后即可按新基线重算。">
            <template #actions><UButton size="sm" color="red" label="值班负责人重算复核" @click="reconfirm" /></template>
          </UAlert>
          <UAlert v-else-if="selected.reviewRequired" color="amber" variant="soft" title="需要值班负责人复核" description="共用隔离点或双份现场值尚未裁决，推进前必须由值班负责人确认。" />
          <h3>操作步骤</h3>
          <div v-for="step in selected.steps" :key="step.id" class="step"><UCheckbox :model-value="step.done" @update:model-value="toggle(step.id)" /><div><b :class="{ completed: step.done }">{{ step.text }}</b><small class="mono">{{ step.opNo }} · {{ step.device }} · 基线 r{{ step.baselineRevision }} · {{ hm(step.occurredAt) }} · 责任人 {{ step.owner }} · {{ step.evidence || '未上传证据' }}</small></div><UButton size="xs" variant="ghost" icon="i-heroicons-camera">证据</UButton></div>
          <UProgress :value="completed" class="mt-4" /><div class="inline justify-between mt-1"><span class="muted">步骤完成度</span><b>{{ completed }}%</b></div>
        </article>
        <aside class="grid right">
          <article class="panel p-4">
            <h3>隔离点与锁定</h3>
            <div v-for="point in selected.isolationPoints" :key="point.id" class="point-block">
              <div class="point"><span><b>{{ point.label }}</b><small class="mono">{{ point.opNo }} · {{ point.device }} · {{ point.type }}</small><small class="mono muted">基线 r{{ point.baselineRevision }} · {{ hm(point.occurredAt) }}</small></span><UBadge :color="point.lockConclusion === '有效' ? 'green' : point.lockConclusion === '待裁决' ? 'red' : 'gray'" variant="subtle">{{ point.lockConclusion }}</UBadge></div>
              <div v-if="point.fieldValues.length" class="field-values">
                <label v-for="fv in point.fieldValues" :key="fv.id" class="field-value" :class="{ chosen: point.adjudgedValueId === fv.id }">
                  <input v-if="point.lockConclusion === '待裁决'" type="radio" :name="`adj-${point.id}`" :value="fv.id" @change="adjudicate(point.id, fv.id)" />
                  <span><b>{{ fv.value }}</b><small class="mono">{{ fv.actor }} · {{ hm(fv.observedAt) }} · {{ fv.source }}</small></span>
                  <UIcon v-if="point.adjudgedValueId === fv.id" name="i-heroicons-check-badge" class="adj-ok" />
                </label>
              </div>
              <UAlert v-if="point.lockConclusion === '待裁决'" color="red" variant="soft" icon="i-heroicons-scale" :title="`${point.label}有两份现场值`" description="由值班负责人点选采纳一份，锁定结论即刻按当前基线生效。" />
              <div v-if="isAdjudicable(point)" class="value-entry"><UInput v-model="fieldDraft[point.id]" size="sm" placeholder="登记现场值（如：锁销到位）" @keyup.enter="submitValue(point.id)" /><UButton size="xs" icon="i-heroicons-arrow-up-tray" @click="submitValue(point.id)">回传</UButton></div>
            </div>
          </article>
          <article class="panel p-4"><h3>流程操作</h3><p class="muted">推进前重新检查：双值裁决、依据失效重算、跨班组重叠。</p><UButton block color="primary" icon="i-heroicons-arrow-right-circle" @click="advance">推进到下一状态</UButton><UButton block class="mt-2" color="gray" variant="outline" icon="i-heroicons-arrow-uturn-left">退回补件</UButton><UButton block class="mt-2" color="red" variant="soft" icon="i-heroicons-exclamation-triangle">申请紧急暂停</UButton></article>
        </aside>
      </section>
    </div>
    <UModal v-model="modal"><article class="p-5"><h2>申请作业许可</h2><p class="muted">提交后进入同一检修批次并处于待复核，系统自动绑定当前基线修订。</p><div class="form-grid"><UFormGroup label="作业名称"><UInput v-model="form.title" /></UFormGroup><UFormGroup label="设备编号"><UInput v-model="form.device" /></UFormGroup><UFormGroup label="班组"><UInput v-model="form.crew" /></UFormGroup><UFormGroup label="负责人"><UInput v-model="form.owner" /></UFormGroup><UFormGroup label="计划窗口"><UInput v-model="form.window" /></UFormGroup><UFormGroup label="风险等级"><USelect v-model="form.risk" :options="['一级','二级','三级']" /></UFormGroup></div><div class="inline justify-end mt-4"><UButton color="gray" @click="modal = false">取消</UButton><UButton color="primary" :disabled="!form.title || !form.device" @click="createPermit">提交复核</UButton></div></article></UModal>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}.permit-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px}.permit-list{padding:8px;height:fit-content}.permit-list button{width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:13px 11px;border:0;background:transparent;border-radius:7px;text-align:left;color:inherit;cursor:pointer}.permit-list button:hover,.permit-list button.active{background:#eff6ff}.permit-list b,.permit-list small{display:block}.permit-list small{color:#667085;margin-top:4px;font-size:12px}.detail-grid{grid-template-columns:minmax(0,1.5fr) minmax(320px,.72fr);gap:16px}.right{height:fit-content;gap:14px}.detail-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:16px}.detail-head h2{margin:4px 0}.detail-head p{margin:0;color:#667085;font-size:13px}.flow{display:grid;grid-template-columns:repeat(5,1fr);margin:20px 0}.flow>div{position:relative;text-align:center;color:#94a3b8}.flow>div:after{content:"";position:absolute;left:55%;right:-45%;top:13px;height:2px;background:#e2e8f0}.flow>div:last-child:after{display:none}.flow i{position:relative;z-index:1;display:grid;place-items:center;width:28px;height:28px;margin:auto;border-radius:50%;background:#e2e8f0;font-style:normal;font-size:12px}.flow span{display:block;font-size:12px;margin-top:5px}.flow .done{color:#2563eb}.flow .done i{background:#2563eb;color:#fff}.flow .done:after{background:#2563eb}.panel h3{font-size:15px;margin:18px 0 10px}.step{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}.step div{flex:1}.step small{display:block;color:#667085;margin-top:4px}.step .completed{text-decoration:line-through;color:#667085}.point-block{padding:10px 0;border-bottom:1px solid #edf0f5}.point{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.point b,.point small{display:block}.point small{color:#667085;margin-top:3px}.field-values{display:grid;gap:6px;margin:8px 0}.field-value{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:7px;background:#f8fafc}.field-value.chosen{border-color:#16a34a;background:#f0fdf4}.field-value span{flex:1}.field-value b,.field-value small{display:block}.field-value small{margin-top:2px}.adj-ok{color:#16a34a}.value-entry{display:flex;gap:8px;margin-top:8px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.mt-2{margin-top:8px}
@media(max-width:980px){.permit-layout{grid-template-columns:1fr}.permit-list{display:flex;overflow:auto}.permit-list button{min-width:230px}.detail-grid{grid-template-columns:1fr}}@media(max-width:620px){.head{flex-direction:column}.form-grid{grid-template-columns:1fr}}
</style>
