/**
 * 此fiber的副作用标记。标记该fiber是否有副作用，及副作用的类型（要进行什么操作）。
 *
 * ## 为什么叫「副作用」？为什么用位掩码？
 * React 的调和过程分为 render 阶段（可中断，构建 workInProgress 树，收集标记）和
 * commit 阶段（不可中断，根据标记执行 DOM 操作）。这些标记就是「待提交到 DOM 的操作」。
 * 位掩码（bitmask）能让一个整数同时存储多种标记，通过 `flag & Mask` 做到 O(1) 判断，
 * 非常适合 reconciliation 这种高频内部循环。
 */
export type Flags = number;

/** 无副作用。默认值，commit 阶段会跳过 NoFlags 的 fiber */
export const NoFlags = 0b0000000;
/** 插入/移动。节点需要被 appendChild / insertBefore 到父节点 */
export const Placement = 0b0000001;
/** 更新。节点属性（props）发生了变化，需要更新 DOM 属性/事件/样式 */
export const Update = 0b0000010;
/**
 * 子节点删除。标记在父 fiber 上——因为被删除的子 fiber 可能已经不在
 * workInProgress 树中了。commit 阶段会遍历父 fiber 的 deletions 数组执行卸载。
 */
export const ChildDeletion = 0b0000100;

/** 被动副作用（useEffect）。在浏览器绘制之后异步执行，不阻塞视觉更新 */
export const PassiveEffect = 0b0001000;
/** Ref 需要处理（set ref callback / assign current）。跨 Mutation（清旧）和 Layout（设新）两个阶段 */
export const Ref = 0b0010000;

/** 可见性切换（Suspense Offscreen 的 display:none ↔ block） */
export const Visibility = 0b0100000;

/** 错误已被 Error Boundary 或 Suspense 成功捕获 */
export const DidCapture = 0b1000000;

/** 错误正在冒泡中，需要被上层捕获但还没找到捕获者 */
export const ShouldCapture = 0b1000000000000;

/** Mutation 阶段掩码：所有同步修改 DOM 树结构的操作都在这里 */
export const MutationMask =
	Placement | Update | ChildDeletion | Ref | Visibility;
/** Layout 阶段掩码：Mutation 之后、浏览器绘制之前，仅处理 Ref */
export const LayoutMask = Ref;

/** Passive 阶段掩码：执行 useEffect 回调 + 被卸载 fiber 的 useEffect 清理函数 */
export const PassiveMask = PassiveEffect | ChildDeletion;

/** 全量掩码：判断 fiber 是否有任何宿主环境副作用需要提交 */
export const HostEffectMask =
	MutationMask | LayoutMask | PassiveMask | DidCapture;
