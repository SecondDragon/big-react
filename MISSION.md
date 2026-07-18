# MISSION: 深入理解 React 内部机制

## 为什么学这个？

你正在从零实现 React 18（big-react 项目），目标是彻底理解 React 的每一个内部子系统是如何工作的。这不仅是为了面试，更是为了建立"我能够设计和实现这类复杂前端框架"的核心能力。

## 学习路线

1. ✅ Symbol 类型系统（ReactSymbols.ts）— 理解 React 为何用 Symbol 标记内部类型
2. ✅ 事件系统（SyntheticEvent.ts）— 理解浏览器原生事件流、事件委托、合成事件的优先级映射
3. ☐ Reconciler 核心（beginWork / completeWork / commitWork）— 理解 Fiber 树遍历与 DOM 挂载
   - ✅ 子节点协调（ChildReconciler / reconcileChildrenArray）— 理解多节点 diff 算法
   - ☐ beginWork 递阶段
   - ☐ completeWork 归阶段
   - ☐ commitWork 提交阶段
4. ☐ Hooks 系统 — 理解 useState / useEffect 的内部实现
5. ☐ 调度系统（Scheduler）— 理解时间切片与优先级调度

## 当前进度

- [2026-07-06] 完成 Symbol 类型系统学习，记录在 learning-records/0001-symbol-in-react.md
- [2026-07-15] 完成事件系统学习：浏览器捕获/冒泡 + 合成事件实现，记录在 learning-records/0002-event-system.md
- [2026-07-15] 完成多节点 Diff 算法学习：React lastPlacedIndex vs Vue 3 前后夹逼 + LIS 对比分析
