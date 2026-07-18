import { createWorkInProgress, FiberNode, FiberRootNode } from './fiber';
import { beginWork } from './beginWork';
import { completeWork } from './completeWork';
import { HostRoot } from './workTags';
import { MutationMask, NoFlags } from './fiberFlags';
import { commitMutationEffect } from './commitWork';
import {
	getHighestPriorityLane,
	Lane,
	markRootFinished,
	mergeLanes,
	NoLane,
	SyncLane
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { scheduleMicroTask } from 'hostConfig';

let workInProgress: FiberNode | null = null;
// 本次更新的lane
let wipRootRenderLane: Lane = NoLane;

/**
 * 准备一个新的工作栈。
 * 调用 createWorkInProgress 基于 root.current（旧 HostRoot fiber）创建/复用 workInProgress。
 * 这是每次 render/update 的入口，在此处建立双缓冲的 alternate 链接。
 *
 * 注意：首次 mount 时只有 HostRoot 的 alternate 在这里被创建，
 * 因此 beginWork 中 HostRoot 会走 update 分支（reconcilerChildFibers），
 * 其余子 fiber 由于刚创建无 alternate，走 mount 分支（mountChildFibers）。
 *
 * @param fiber FiberRootNode 实例
 * @param lane
 */
function prepareFreshStack(fiber: FiberRootNode, lane: Lane) {
	workInProgress = createWorkInProgress(
		fiber.current,
		fiber.current.pendingProps
	);
	wipRootRenderLane = lane;
}

/**
 * 未来的更新的调度函数，现在只作为连接更新的操作，后续会添加更多的逻辑
 * @param fiber
 * @param lane
 */
export function scheduleUpdateOnFiber(fiber: FiberNode, lane: Lane) {
	//  TODO: 实现调度逻辑
	// 尝试去找到FiberRootNode调度管理器
	const root = markUpdateFromFiberToRoot(fiber);
	markRootUpdated(root, lane);
	ensureRootIsScheduled(root);
	// renderRoot(root as FiberRootNode);
}

export function markRootUpdated(root: FiberRootNode, lane: Lane) {
	root.pendingLanes = mergeLanes(root.pendingLanes, lane);
}

// schedule阶段入口,需要完成两件事:实现「某些判断机制」，选出一个lane
// 实现类似防抖、节流的效果，合并宏/微任务中触发的更新
export function ensureRootIsScheduled(root: FiberRootNode) {
	const updateLane = getHighestPriorityLane(root.pendingLanes);
	if (updateLane === NoLane) {
		// 没有更新
		return;
	}

	if (updateLane === SyncLane) {
		// 	同步优先级，也就是说是高优先级
		// 	使用微任务来调度，保证优先级
		if (__DEV__) {
			console.log('在微任务中调度，优先级:', updateLane);
		}
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane));
		scheduleMicroTask(flushSyncCallbacks);
	} else {
		// 	其他优先级，宏任务调度
	}
}

/**
 * 从fiber节点向上遍历，找到根节点。注意,react的更新一定会找到根节点
 * @param fiber
 * @returns
 */
export function markUpdateFromFiberToRoot(fiber: FiberNode) {
	let node = fiber;
	let parent = fiber.return;
	while (parent !== null) {
		node = parent;
		parent = parent.return;
	}
	// HostRoot 说明找到了根fiberNode，再向上一级就是 FiberRootNode
	if (node.tag === HostRoot) {
		return node.stateNode;
	}
	return null;
}

/**
 * render 阶段的调度入口。
 * 1. prepareFreshStack → 创建 HostRoot 的 workInProgress
 * 2. workLoop → beginWork + completeWork 构建 fiber 树
 * 3. 取 root.current.alternate 作为 finishedWork
 * 4. commitRoot → 执行 DOM 操作
 *
 * @param root FiberRootNode 实例
 * @param lane
 */
// 这是同步更新的入口
function performSyncWorkOnRoot(root: FiberRootNode, lane: Lane) {
	const nextLane = getHighestPriorityLane(root.pendingLanes);
	if (nextLane !== SyncLane) {
		// 	其他比SyncLane低的优先级
		// 	NoLane
		// 再调度一次
		ensureRootIsScheduled(root);
		return;
	}
	if (__DEV__) {
		console.warn('render阶段开始');
	}

	prepareFreshStack(root, lane);

	do {
		try {
			// 执行工作循环
			workLoop();
			break;
		} catch (error) {
			if (__DEV__) {
				console.warn('workLoop发生错误', error);
			}
			workInProgress = null;
		}
	} while (true);
	// 这就是构建完成的哪棵树
	const finishedWork = root.current.alternate;
	root.finishedWork = finishedWork;
	root.finishedLane = lane;
	wipRootRenderLane = lane;
	// 这里会执行具体的dom操作，把整颗树要做的操作都提交到dom中
	commitRoot(root);
}

/**
 * commit 阶段入口。
 * 检查 finishedWork 的 subtreeFlags + flags 中是否有 MutationMask 标记，
 * 有则执行 commitMutationEffect，最后 root.current = finishedWork 完成双缓冲切换。
 *
 * @param root FiberRootNode 实例
 */
function commitRoot(root: FiberRootNode) {
	const finishedWork = root.finishedWork;
	if (finishedWork === null) {
		return;
	}
	if (__DEV__) {
		console.warn('commit阶段开始', finishedWork);
	}

	const lane = root.finishedLane;
	if (lane === NoLane && __DEV__) {
		console.error('commit阶段finishedLane 不应该是NoLane');
	}

	// 重置
	root.finishedWork = null;
	root.finishedLane = NoLane;
	markRootFinished(root, lane);

	// 判断三个阶段是否存在
	const subtreeHasEffect =
		(finishedWork.subtreeFlags & MutationMask) !== NoFlags;
	const rootHasEffect = finishedWork.flags & MutationMask;

	if (subtreeHasEffect || rootHasEffect) {
		// beforeMutation 阶段
		commitMutationEffect(finishedWork);
		// mutation 阶段
		// layout 阶段
		root.current = finishedWork;
	} else {
		console.log('23423432');
		root.current = finishedWork;
		// 	root.current就是新的 HostRoot，它有child/memoizedState，会在更新时使用
	}
}

/**
 * 工作循环主函数。
 * 同步遍历 workInProgress 链表，对每个节点执行 performUnitOfWork，
 * 直到 workInProgress 为 null（整棵树处理完毕）。
 */
function workLoop() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}

/**
 * 对一个 fiber 节点执行一次"递→归"的工作单元。
 * 1. beginWork(wip) — 向下"递"：处理当前 fiber，返回第一个子 fiber
 * 2. fiber.memoizedProps = fiber.pendingProps — 将本次 props 固化为已处理状态
 * 3. 有子节点 → workInProgress 指向子节点继续向下
 *    无子节点 → completeUnitOfWork 开始向上"归"
 *
 * @param fiber 当前 workInProgress
 */
function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber, wipRootRenderLane);
	// 执行完之后memoizedProps = pendingProps
	fiber.memoizedProps = fiber.pendingProps;
	// 该fiber的子节点即将处理完成，将pendingProps赋值给memoizedProps
	if (next === null) {
		// 没有子节点，返回兄弟节点
		completeUnitOfWork(fiber);
	} else {
		workInProgress = next as FiberNode | null;
	}
}
/**
 * 这个函数由于有do while ，实际上它一开始执行就再也不会放弃执行权，
 * 他会一直在自己的 do while 里
 * 对所有的node执行completeWork
 *
 * @param fiber
 */
function completeUnitOfWork(fiber: FiberNode) {
	// 递归中的归的操作
	let node: FiberNode | null = fiber;
	// 只要node不为null，就会一直执行，实际上就是会一直执行到 根 HostRoot 类型的 fiberNode
	do {
		// 完成当前fiber的处理
		completeWork(node);
		// 获取兄弟节点开始处理
		const sibling = node.sibling;
		if (sibling !== null) {
			workInProgress = sibling;
			// return 会跳出 do while 循环，转而由 workLoop 继续处理兄弟节点
			return;
		}
		// 如果兄弟节点也处理完了，再去回归到父节点
		node = node.return;
		workInProgress = node;
	} while (node !== null);
}
