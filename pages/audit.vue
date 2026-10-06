<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'

const store = useOperationsStore()
const keyword = ref('')
const onlyMerged = ref(false)
const sorted = computed(() =>
  [...store.audit].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.opNo.localeCompare(a.opNo)),
)
const filtered = computed(() =>
  sorted.value.filter((event) => {
    const hit = `${event.opNo}${event.batchId ?? ''}${event.device ?? ''}${event.actor}${event.action}${event.target}${event.detail}`.includes(keyword.value)
    return hit && (!onlyMerged.value || event.merged)
  }),
)
</script>

<template>
  <div class="page">
    <div class="head"><div><p class="eyebrow">不可覆盖的操作记录 · 同号操作仅一条审计</p><h1 class="page-title">审计与交接时间线</h1><p class="muted">每条记录带操作号、设备编号、基线修订与发生时间；断网记录回网后按项合并并标注来源。</p></div><UButton color="gray" variant="outline" icon="i-heroicons-arrow-down-tray">导出审计包</UButton></div>
    <section class="panel p-4">
      <div class="inline justify-between wrap mb-4">
        <UInput v-model="keyword" icon="i-heroicons-magnifying-glass" placeholder="搜索操作号、人员、许可或设备" class="search" />
        <div class="inline">
          <UCheckbox v-model="onlyMerged" label="仅看断网合并记录" />
          <UBadge color="gray">共 {{ filtered.length }} 条</UBadge>
          <UBadge v-if="store.checkpoint" color="green" variant="subtle" icon="i-heroicons-flag">检查点 {{ store.checkpoint.appliedOpNos.length }} 项 · {{ store.checkpoint.at.slice(11, 16) }}</UBadge>
        </div>
      </div>
      <div class="timeline">
        <div v-for="event in filtered" :key="event.opNo" class="event">
          <time>{{ event.time }}</time><i :class="{ merged: event.merged }"></i>
          <div>
            <div class="inline wrap">
              <b>{{ event.actor }}</b>
              <UBadge size="xs" :variant="event.merged ? 'solid' : 'subtle'" :color="event.merged ? 'amber' : 'primary'">{{ event.action }}</UBadge>
              <UBadge size="xs" color="gray" variant="subtle">{{ event.source }}</UBadge>
              <span v-if="event.merged" class="tag">断网合并</span>
              <span class="target">{{ event.target }}</span>
            </div>
            <p>{{ event.detail }}</p>
            <small class="meta mono">{{ event.opNo }}<template v-if="event.device"> · {{ event.device }}</template><template v-if="event.batchId"> · {{ event.batchId }}</template> · 基线 r{{ event.baselineRevision }} · 发生 {{ event.occurredAt.slice(0, 16).replace('T', ' ') }}</small>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.search{min-width:300px}.mono{font-family:ui-monospace,Menlo,Consolas,monospace}.timeline{padding:4px 0}.event{display:grid;grid-template-columns:65px 16px 1fr;gap:10px;position:relative;padding:7px 0}.event time{color:#667085;font-size:13px;padding-top:3px}.event i{position:relative;width:10px;height:10px;border-radius:50%;background:#2563eb;top:7px;z-index:1;box-shadow:0 0 0 4px #dbeafe}.event i.merged{background:#d97706;box-shadow:0 0 0 4px #fef3c7}.event:not(:last-child):after{content:"";position:absolute;left:77px;top:21px;bottom:-7px;width:2px;background:#dbeafe}.event>div{border-bottom:1px solid #edf0f5;padding:0 0 14px 8px}.event p{margin:6px 0 0;color:#667085}.target{font-family:monospace;color:#475569;font-size:12px}.tag{font-size:11px;background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px}.meta{display:block;color:#94a3b8;margin-top:6px}
@media(max-width:620px){.head{flex-direction:column;gap:12px}.event{grid-template-columns:55px 14px 1fr}.event:not(:last-child):after{left:64px}.search{min-width:100%}.inline.justify-between{align-items:flex-start;flex-direction:column}}
</style>
