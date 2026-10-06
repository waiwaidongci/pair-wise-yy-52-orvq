# 风电场检修隔离与作业许可协调平台

源提示词编号：9。覆盖风机、箱变和线路隔离点、锁定与验电步骤、作业许可状态流、跨班组冲突检测、实时提醒、断线重连、失败操作重试和审计记录。

## 检修批次一致性模型

- 同一份**检修批次**（`MaintenanceBatch`，`utils/batch.ts`）串起作业许可、隔离点、操作步骤与审计记录；每项都带 **操作号 `opNo`、设备编号、基线修订 `baselineRevision`、发生时间 `occurredAt`**。
- **断网回网按项合并**：塔基无网时操作写入本地待补录队列（`OfflineRecord`），回站后按操作号合并；未碰同一项的记录按发生时间顺序补入库；同号操作幂等，重试/重放不再多生成审计。
- **补录检查点**：`syncOffline({ failFirst: true })` 可模拟首次失败，之后从最后完整检查点之后重放，已入库操作号不重复应用。
- **双份现场值待裁决**：叶轮机械锁、箱变低压侧刀闸出现两份不一致现场值时锁定结论置为「待裁决」，许可推进被拦截，由值班负责人点选采纳（`adjudicate`）。
- **依据变化即失效重算**：风速、设备编号、母线边界任一变化，批次基线修订 +1，相关锁定结论失效、许可阶段退回「待复核」；其他许可沿用，值班负责人重算复核后恢复（`invalidateForBasisChange` / `reconfirmPermit`）。
- **旧草稿升级**：缺少操作号的历史草稿（localStorage v1）在首次加载时经 `upgradeLegacyDraft` 补齐操作号与基线，并整体升级为「待复核」批次（v2）。

## 技术栈

Nuxt 3、Nuxt UI、Pinia、Nuxt Router、TanStack Query、ofetch、WebSocket 模拟、TypeScript。

## 运行

```bash
npm install
npm run dev
```

开发地址：http://localhost:62052

```bash
npm run build
```
