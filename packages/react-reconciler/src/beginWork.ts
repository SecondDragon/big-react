/**
 *  beginWork 开始工作
 *  会一竿子插到底，直到遇到叶子节点
 *  是递归中的递的操作
 */
import { FiberNode } from './fiber';
import {
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';
import { processUpdateQueue, UpdateQueue } from './updateQueue';
import { ReactElementType } from 'shared/ReactTypes';
import { mountChildFibers, reconcileChildFibers } from './childFibers';
import { renderWithHooks } from './fiberHooks';
import { Lane } from './fiberLanes';

/**
 * beginWork 是整个 render 阶段"递"操作的入口。
 * 根据 wip.tag 分发到不同的处理函数，返回当前 fiber 的第一个子 fiber。
 * 返回 null 表示到达叶子节点（HostText / 无子节点），此时 performUnitOfWork 会转而调用 completeUnitOfWork。
 *
 * @param wip 当前正在处理的 workInProgress fiber
 * @param renderLane
 * @returns 第一个子 fiber，或 null
 */
export const beginWork = (wip: FiberNode, renderLane: Lane) => {
	switch (wip.tag) {
		case HostRoot:
			return updateHostRoot(wip, renderLane);
		case HostComponent:
			return updateHostComponent(wip);
		case HostText:
			// HostText是文本，没有子节点了
			return null;
		case FunctionComponent:
			return updateFunctionComponent(wip, renderLane);
		case Fragment:
			return updateFragment(wip);
		default:
			if (__DEV__) {
				console.warn('beginWork 未实现的类型 ', wip.tag);
			}
			break;
	}
	// return wip.child;
	return null;
};

function updateFragment(wip: FiberNode) {
	console.log(
		'updateFragment:fiber',
		wip,
		'fiber.pendingProps',
		wip.pendingProps
	);
	const nextChildren = wip.pendingProps;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 处理函数式组件的 beginWork。
 * 1. 调用 renderWithHooks 执行组件函数，得到返回的 ReactElement（或原始值）
 *    此过程会根据 wip.alternate 切换 Hook 的 mount/update Dispatcher
 * 2. 调用 reconcileChildren 用 ReactElement 和旧 fiber 做对比，创建/复用子 fiber
 * 3. 返回 wip.child
 *
 * @param wip 函数组件的 workInProgress fiber
 * @param renderLane
 */
function updateFunctionComponent(wip: FiberNode, renderLane: Lane) {
	const nextChildren = renderWithHooks(wip, renderLane);
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 协调子节点：用 newChild 和旧 fiber 树（current child）做对比，生成/复用子 fiber。
 *
 * 通过 wip.alternate 判断当前是 mount 还是 update：
 * - current !== null（update）→ 用 reconcilerChildFibers，子 fiber 需标记 Placement / ChildDeletion
 * - current === null（mount）→ 用 mountChildFibers，子 fiber 不标记副作用，离屏构建 DOM
 *
 * @param wip 当前 workInProgress fiber
 * @param children 新的子内容。来源：
 *   - HostRoot: 从 updateQueue 消费出的 ReactElement（如 <App/>）
 *   - FunctionComponent: Component(props) 的返回值（ReactElement 或 原始值）
 *   - HostComponent: wip.pendingProps.children（ReactElement 或 原始值）
 */
function reconcileChildren(wip: FiberNode, children?: ReactElementType) {
	// createWorkInProgress 中写明了 wip.alternate 是 current,current就是已经渲染的fiberNode
	// 拿current 和现有的 children 对比，修改 wip
	const current = wip.alternate;
	if (current !== null) {
		// 	是update的流程
		console.log(
			'是update的流程-wip',
			wip,
			'wip.type',
			wip.type,
			'current.child',
			current.child,
			'children',
			children
		);

		wip.child = reconcileChildFibers(wip, current.child, children);
	} else {
		// current 为null，是mount的流程
		console.log(
			'是mount的流程-wip',
			wip,
			'wip.type',
			wip.type,
			'current.child',
			null,
			'children',
			children
		);
		wip.child = mountChildFibers(wip, null, children);
	}
	// mount 时存在大量的插入，如果每个都进行标记，就会浪费性能，完全可以先离屏创建，之后再一次挂载
	// @ts-ignore
	// reconcilerChildFibers(wip, current.child, children);
}

/**
 * 处理 HostRoot 的 beginWork。
 * HostRoot 的 memoizedState 存储的是 render 传入的 ReactElement（如 <App/>）。
 *
 * 流程：
 * 1. 从 updateQueue 中取出 pending 的 update，调用 processUpdateQueue 消费
 * 2. 将消费结果（ReactElement）存回 wip.memoizedState
 * 3. 调用 reconcileChildren，传入 ReactElement，对比 current.child 生成子 fiber
 *
 * @param wip HostRoot 类型的 workInProgress fiber
 * @param renderLane
 */
function updateHostRoot(wip: FiberNode, renderLane: Lane) {
	const baseState = wip.memoizedState; // HostRoot的memoizedState最初肯定是null
	const updateQueue = wip.updateQueue as UpdateQueue<Element>; // 这里的UpdateQueue<Element>是创建时拿到的
	const pending = updateQueue.shared.pending;

	// 计算完成后 重置pending，这里写的有点靠前了
	updateQueue.shared.pending = null;
	// pending里有ReactElement
	const { memoizedState } = processUpdateQueue(baseState, pending, renderLane);
	// 更新memoizedState
	wip.memoizedState = memoizedState;
	// 根节点 要创建子fiberNode
	// 实际上是通过对比 子fiberNode 和 ReactElement 来创建子fiberNode
	//根的 memoizedState 是一个 ReactElement
	const nextChildren = wip.memoizedState;
	reconcileChildren(wip, nextChildren);

	return wip.child;
}

/**
 * 处理 HostComponent（如 div、span）的 beginWork。
 * HostComponent 自身不持有状态，不会被 setState 触发更新。
 * 它只从 pendingProps.children 取出子内容，交给 reconcileChildren 协调。
 *
 * @param wip HostComponent 类型的 workInProgress fiber
 */
function updateHostComponent(wip: FiberNode) {
	const nextProps = wip.pendingProps;
	// 针对非函数ReactElement节点，也就是正常原始dom对应的ReactElement节点，pendingProps中就是他的children
	const nextChildren = nextProps.children;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}
