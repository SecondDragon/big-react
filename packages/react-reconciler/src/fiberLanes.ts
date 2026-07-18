import { FiberRootNode } from './fiber';

export type Lane = number;
export type Lanes = number;

export const SyncLane = 0b00001;
export const NoLane = 0b00000;
export const NoLanes = 0b00000;
export const InputContinuousLane = 0b00010;
export const DefaultLane = 0b00100;
export const TransitionLane = 0b01000;
export const IdleLane = 0b10000;

export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
	return laneA | laneB;
}
export function requestUpdateLane() {
	return SyncLane;
}

export function getHighestPriorityLane(lanes: Lanes): Lane {
	//
	return lanes & -lanes;
}
/**
 * 把"已经消费完的 lane"从 root.pendingLanes 中清除，宣告该优先级的更新已全部处理完毕。
 *
 * 执行流程：
 * 1. commitRoot 完成本次 commit 后调用 markRootFinished(root, lane)；
 * 2. 通过位运算 `pendingLanes &= ~lane`，把 pendingLanes 中代表该 lane 的二进制位置 0；
 * 3. 之后 performSyncWorkOnRoot / ensureRootIsScheduled 再读取 pendingLanes 时，
 *    若得到 NoLane，说明没有剩余更新，直接 return（bailout），不再 render。
 *
 * 位运算拆解（以 SyncLane 为例）：
 *   SyncLane        = 0b00001
 *   ~SyncLane       = 0b11110  （取反：只有 SyncLane 那一位是 0，其余全是 1）
 *   pendingLanes    = 0b00101  （假设同时挂着 SyncLane + DefaultLane）
 *   0b00101 & 0b11110 = 0b00100 → SyncLane 被清掉，DefaultLane 保留
 *
 * ⚠️ 常见笔误（本项目曾真实踩过的坑）：
 * 写成 `root.finishedLane &= ~lane` —— 清错了字段！
 *   - finishedLane 只是"本次提交的 lane"的记录字段，不影响调度判断；
 *   - 真正决定"还有没有更新要处理"的是 pendingLanes（见 markRootUpdated 只会给它置位，
 *     全项目只有本函数负责给它清零）。
 *
 * 踩坑后的故障现象推演（demo：一次点击里连续 3 次 setNum(v => v + 1)，初始 num = 100）：
 *
 *   ① 点击触发 3 次 dispatchSetState：
 *        - 3 个 update 进入同一个 hook 的环形链表
 *        - markRootUpdated × 3 → pendingLanes = 0b00001（SyncLane）
 *        - scheduleSyncCallback × 3 → syncQueue = [cb1, cb2, cb3]
 *          （3 个回调都是 performSyncWorkOnRoot.bind(null, root, SyncLane)）
 *
 *   ② 微任务 flushSyncCallbacks 依次执行 3 个回调：
 *        cb1：nextLane === SyncLane → render（num 100 → 103）→ commit
 *              → markRootFinished 清的是 finishedLane，pendingLanes 仍是 0b00001 ❌
 *        cb2：读取 pendingLanes → nextLane 仍是 SyncLane → 无法 bailout
 *              → 又 render 一次（num 103 → 106）→ 又 commit 一次 ❌
 *        cb3：同理，第三次 render（num 106 → 109）→ 第三次 commit ❌
 *
 *   ③ 最终表现：只点了一次，却 render 3 次、commit 3 次、num 从 100 跳到 109，
 *      且两次 render 之间没有任何新的调度日志（因为根本没有新的 setState）。
 *
 * 结论：本函数必须与 markRootUpdated 操作同一个字段 pendingLanes，
 * 一个置位、一个清零，构成完整的"更新记账"闭环；清错字段会导致调度系统
 * 认为更新永远未完成，残留的调度回调会反复触发 render。
 *
 * @param root FiberRootNode 实例
 * @param lane 本次已经完成 render + commit 的 lane
 */
export function markRootFinished(root: FiberRootNode, lane: Lane) {
	root.pendingLanes &= ~lane;
}

export function getNextLane(root: FiberRootNode): Lane {
	const pendingLanes = root.pendingLanes;

	if (pendingLanes === NoLanes) {
		return NoLane;
	}
	let nextLane = NoLane;

	// // 排除掉挂起的lane
	// const suspendedLanes = pendingLanes & ~root.suspendedLanes;
	// if (suspendedLanes !== NoLanes) {
	// 	nextLane = getHighestPriorityLane(suspendedLanes);
	// } else {
	// 	const pingedLanes = pendingLanes & root.pingedLanes;
	// 	if (pingedLanes !== NoLanes) {
	// 		nextLane = getHighestPriorityLane(pingedLanes);
	// 	}
	// }
	return nextLane;
}
