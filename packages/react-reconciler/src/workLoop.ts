import { createWorkInProgress, FiberNode, FiberRootNode } from './fiber';
import { beginWork } from './beginWork';
import { completeWork } from './completeWork';
import { HostRoot } from './workTags';
import { MutationMask, NoFlags } from './fiberFlags';
import { commitMutationEffect } from './commitWork';

let workInProgress: FiberNode | null = null;

/**
 * 给
 * @param fiber
 */
function prepareFreshStack(fiber: FiberRootNode) {
	// fiber.current指向根fiberNode
	/**
	 * 由此看出，每次更新都会找到FiberRootNode，然后再从HostRoot类型的fiberNode节点开始走
	 * 这里会返回 fiber.current （HostRoot类型的fiberNode节点）的alternate作为workInProgress
	 * 之后都会处理这个节点
	 */
	workInProgress = createWorkInProgress(
		fiber.current,
		fiber.current.pendingProps
	);
}

/**
 * 未来的更新的调度函数，现在只作为连接更新的操作，后续会添加更多的逻辑
 * @param fiber
 */
export function scheduleUpdateOnFiber(fiber: FiberNode) {
	//  TODO: 实现调度逻辑
	// 尝试去找到FiberRootNode，哪个调度管理器
	const root = markUpdateFromFiberToRoot(fiber);
	renderRoot(root as FiberRootNode);
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

function renderRoot(root: FiberRootNode) {
	prepareFreshStack(root);

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
	// 这里会执行具体的dom操作，把整颗树要做的操作都提交到dom中
	commitRoot(root);
}

function commitRoot(root: FiberRootNode) {
	const finishedWork = root.finishedWork;
	if (finishedWork === null) {
		return;
	}
	if (__DEV__) {
		console.warn('commit阶段开始', finishedWork);
	}

	root.finishedWork = null;
	// 判断三个阶段是否存在
	const subtreeHasEffect =
		(finishedWork.subtreeFlags & MutationMask) !== NoFlags;
	const rootHasEffect = finishedWork.flags & MutationMask;

	if (subtreeHasEffect || rootHasEffect) {
		// beforeMutation 阶段
		commitMutationEffect(finishedWork);
		// mutation 阶段
		// layout 阶段
	} else {
		console.log('23423432');
	}
}

function workLoop() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}

/**
 * 执行单个fiber节点的工作单元
 * @param fiber
 */
function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber);
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
			// return 会结束循环的，我脑子有病，竟然忘了
			return;
		}
		// 如果兄弟节点也处理完了，再去回归到父节点
		node = node.return;
		workInProgress = node;
	} while (node !== null);
}
