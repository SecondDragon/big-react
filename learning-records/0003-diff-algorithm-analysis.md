# 学习记录 0003：React vs Vue 3 Diff 算法对比分析

## 日期

2026-07-15

## 学习内容

深入分析了 React（big-react 中的 `reconcileChildrenArray`）与 Vue 3（`patchKeyedChildren`）在多子节点协调上的算法差异。

### React 的算法（`lastPlacedIndex`）

- **流程**：建 Map → 遍历新列表 → `lastPlacedIndex` 贪心判定 → 删除 Map 剩余
- **核心思想**：从左到右单向扫描，维护一个"已确认不动节点的最大 oldIndex"
- **优势**：O(n) 稳定，代码极其简单（~80 行）
- **劣势**：在整体右移/反转等场景会产生多余 DOM 操作

### Vue 3 的算法（前后夹逼 + LIS）

- **流程**：前端夹逼 → 后端夹逼 → 构建新-旧 index Map → LIS 确定最小移动
- **核心思想**：夹逼过滤常见场景（头插/尾插/反转），LIS 保证理论最优移动数
- **优势**：头插/尾插/反转 O(1)，复杂重排逻辑最优
- **劣势**：代码更复杂（~150 行），LIS 有 O(n log n) 额外开销

## 关键发现

1. **`lastPlacedIndex` 的失效模式**：当某个靠右的节点（如 E, index=4）先出现并被判定为不动时，它会将边界推到 4，导致所有 oldIndex < 4 的节点即使相对位置正确也会被判定为需要移动
2. **前后夹逼只能处理头/尾匹配的场景**（如 prepend/append 导致有一方完全匹配完），对于整体右移/反转这样的复杂重排，夹逼并不起作用，仍需要走核心 LIS diff
3. **LIS 保证不出错**：虽然头插场景 React 贪心不一定比 LIS 差很多，但 LIS 在任何场景都不会产生多余移动
4. **反转场景两者打平**：`[4,3,2,1]` 的 LIS 长度仅为 1，Vue 3 同样需要移动 3 个节点，与 React 完全一致

## 对 big-react 项目的影响

- 当前 `reconcileChildrenArray` 的实现与 React 官方一致
- 理解这个算法有助于后续理解 `beginWork` 和 `commitWork` 中对 `Placement`/`ChildDeletion` 标记的处理
- 如果后续项目需要性能调优，可以关注列表场景是否触发 `lastPlacedIndex` 的非优分支

## 下一步建议

- 继续学习 `beginWork` 递阶段的完整流程
- 深入 `completeWork` 中 DOM 节点的创建与属性设置
- 学习 `commitWork` 中对 Placement/ChildDeletion 标记的实际处理

## 参考资料

- big-react childFibers.ts
- Vue 3 源码 packages/runtime-core/src/renderer.ts 中的 patchKeyedChildren
- 本文档记录在 docs/diff-algorithm-complete-analysis.md
