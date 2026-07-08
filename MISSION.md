# MISSION: 深入理解 JavaScript Symbol 及其在 React 内部机制中的应用

## 为什么学这个？

你正在从零实现 React 18（大 React 项目），而 React 的**内部类型系统**完全依赖 `Symbol` 来标记不同类型的虚拟节点（Element、Fragment、Context、Provider、Memo 等）。

**如果不能彻底理解 Symbol**，你就无法回答以下问题：

- 为什么 `Symbol.for('react.element')` 比用字符串 `'div'` 判断类型更安全？
- 在浏览器不支持 Symbol 时，React 为什么退回到 `0xeac7` 这种魔数？
- 为什么不能直接用 `=== 'react.element'` 来判断节点类型？
- 这个设计对我自己写前端库有什么启发？

## 学习目标

1. ✅ 理解 JavaScript `Symbol` 的底层原理：唯一性、隐藏性、全局注册表
2. ✅ 理解 React 为什么选择 Symbol 作为内部类型的标记机制
3. ✅ 理解 `Symbol.for()` 与 `Symbol()` 的区别，以及 React 为什么用 `.for()`
4. ✅ 能向别人清晰解释 `ReactSymbols.ts` 中每一行的设计意图
5. ☐ 将来能在自己的项目中借鉴这种模式

## 当前进度

- [2024-07-06] 开始学习：从 `ReactSymbols.ts` 切入，理解 Symbol 的核心概念
