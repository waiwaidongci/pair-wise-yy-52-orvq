<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'

const store = useOperationsStore()
const selectedDevice = ref('WTG-03')
const selectedPoints = computed(() => store.permits.flatMap((permit) => permit.isolationPoints).filter((point) => point.device.includes(selectedDevice.value)))
const devices = [
  { id: 'WTG-03', name: '3 号风力发电机组', state: '检修隔离', load: '0 kW', points: 3, crew: '机务二班' },
  { id: 'LINE-A2', name: 'A2 集电线路', state: '待隔离', load: '0.8 MW', points: 3, crew: '线路一班' },
  { id: 'BOX-12', name: '12 号箱式变压器', state: '运行', load: '2.4 MW', points: 1, crew: '电气一班' },
  { id: 'BUS-A', name: 'A 段 35kV 母线', state: '运行', load: '18.6 MW', points: 1, crew: '公用' },
]
</script>

<template>
  <div class="page">
    <div class="head"><div><p class="eyebrow">LOCKOUT / TAGOUT</p><h1 class="page-title">设备隔离与锁定点</h1><p class="muted">统一维护设备隔离点、锁具、验电步骤和跨班组占用状态。</p></div><UButton color="primary" icon="i-heroicons-plus">登记隔离点</UButton></div>
    <div class="device-grid">
      <article v-for="device in devices" :key="device.id" class="panel device" :class="{ active: selectedDevice === device.id }" @click="selectedDevice = device.id"><div class="inline justify-between"><UBadge variant="subtle">{{ device.id }}</UBadge><UBadge :color="device.state === '运行' ? 'green' : device.state === '检修隔离' ? 'red' : 'amber'" variant="subtle">{{ device.state }}</UBadge></div><h2>{{ device.name }}</h2><div class="kv"><span>当前负荷</span><b>{{ device.load }}</b></div><div class="kv"><span>隔离点</span><b>{{ device.points }} 个</b></div><div class="kv"><span>责任班组</span><b>{{ device.crew }}</b></div></article>
    </div>
    <section class="grid lower"><article class="panel p-4"><h2>{{ selectedDevice }} · 隔离检查单</h2><div v-for="point in selectedPoints" :key="point.id" class="point"><div class="lock-icon"><UIcon name="i-heroicons-lock-closed" /></div><div><b>{{ point.label }}</b><small class="mono">{{ point.opNo }} · {{ point.type }} · 基线 r{{ point.baselineRevision }} · {{ point.occurredAt.slice(11, 16) }}</small></div><UBadge :color="point.lockConclusion === '有效' ? 'green' : point.lockConclusion === '待裁决' ? 'red' : 'gray'" variant="subtle">{{ point.lockConclusion }}</UBadge><UButton size="xs" variant="ghost">操作记录</UButton></div><UAlert v-if="!selectedPoints.length" color="gray" title="该设备暂无隔离点" description="可在许可中新建隔离点并关联设备。" /></article><article class="panel p-4"><h2>交叉冲突与双值裁决</h2><UAlert color="red" variant="soft" title="LINE-A2 与 BOX-12 共用母线隔离边界" description="两个作业在同一时间窗内涉及 BUS-A，需由值班负责人确认先后顺序与交接条件。" /><UAlert v-for="permit in store.conflictPermits" :key="permit.id" class="mt-2" color="amber" variant="soft" :title="`${permit.id} 待值班负责人处理`" :description="permit.invalidated ? `${permit.invalidated.reason}导致锁定结论与许可阶段失效，需重算复核` : '叶轮机械锁或箱变低压侧刀闸存在两份现场值'" :actions="[{ label: '前往裁决', click: () => navigateTo(`/permits?id=${permit.id}`) }]" /><h3 class="mt-4">锁定器具台账</h3><div class="tool"><span>LK-2107</span><b>WTG-03 · 周野</b></div><div class="tool"><span>LK-2118</span><b>LINE-A2 · 待领用</b></div><div class="tool"><span>GND-042</span><b>17 号杆 · 谭勇</b></div><UButton block color="primary" class="mt-4" icon="i-heroicons-check-badge">完成隔离确认</UButton></article></section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.device-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.device{padding:16px;cursor:pointer}.device.active{border-color:#2563eb;box-shadow:0 0 0 2px #dbeafe}.device h2{font-size:16px;margin:14px 0}.kv{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #edf0f5;font-size:13px}.kv span{color:#667085}.lower{grid-template-columns:1.3fr .7fr;gap:16px}.panel h2{font-size:17px;margin:0 0 14px}.point{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #edf0f5}.point>div:nth-child(2){flex:1}.point b,.point small{display:block}.point small{color:#667085;margin-top:4px}.lock-icon{display:grid;place-items:center;width:34px;height:34px;background:#eff6ff;color:#2563eb;border-radius:7px}.tool{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #edf0f5}.tool span{color:#2563eb;font-family:monospace}.tool b{font-size:13px}.mono{font-family:ui-monospace,Menlo,Consolas,monospace}.mt-4{margin-top:8px;margin-bottom:8px}
@media(max-width:1050px){.device-grid{grid-template-columns:1fr 1fr}.lower{grid-template-columns:1fr}}@media(max-width:600px){.head{flex-direction:column;gap:12px}.device-grid{grid-template-columns:1fr}}
</style>
