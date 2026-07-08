/**
 *  beginWork 开始工作
 *  会一竿子插到底，直到遇到叶子节点
 *  是递归中的递的操作
 */
import { FiberNode } from './fiber';
import { HostRoot, HostComponent, HostText } from './workTags';
import { processUpdateQueue, UpdateQueue } from './updateQueue';
import { ReactElementType } from 'shared/ReactTypes';
import { mountChildFibers, reconcilerChildFibers } from './childFibers';
import { __DEV__ } from './reconciler';

// 返回当前fiber节点的子节点
export const beginWork = (wip: FiberNode) => {
	// 比较 ReactElement 和 fiberNode 返回子fiberNode
	switch (wip.tag) {
		case HostRoot:
			return updateHostRoot(wip);
		case HostComponent:
			return updateHostComponent(wip);
		case HostText:
			return null;
		default:
			if (__DEV__) {
				console.warn('beginWork 未实现的类型 ', wip.tag);
			}
			break;
	}
	return wip.child;
};

function reconcilerChildren(wip: FiberNode, children?: ReactElementType) {
	// createWorkInProgress 中写明了 wip.alternate 是 current,current就是已经渲染的fiberNode
	// 拿current 和现有的children 对比，修改 wip
	const current = wip.alternate;
	if (current === null) {
		// 	是update的流程

		wip.child = reconcilerChildFibers(wip, current, children);
	} else {
		// current 为null，是mount的流程
		wip.child = mountChildFibers(wip, current.child, children);
	}
	// mount 时存在大量的插入，如果每个都进行标记，就会浪费性能，完全可以先离屏创建，之后再一次挂载
	// @ts-ignore
	// reconcilerChildFibers(wip, current.child, children);
}

function updateHostRoot(wip: FiberNode) {
	const baseState = wip.memoizedState;
	const updateQueue = wip.updateQueue as UpdateQueue<Element>;
	const pending = updateQueue.shared.pending;

	// 计算完成后 重置pending
	updateQueue.shared.pending = null;
	const { memoizedState } = processUpdateQueue(baseState, pending);
	// 更新memoizedState
	wip.memoizedState = memoizedState;
	// 根节点 要创建子fiberNode
	// 实际上是通过对比 子fiberNode 和 ReactElement 来创建子fiberNode
	//根的 memoizedState 是一个 ReactElement
	const nextChildren = wip.memoizedState;
	reconcilerChildren(wip, nextChildren);

	return wip.child;
}

function updateHostComponent(wip: FiberNode) {
	const nextProps = wip.pendingProps;
	const nextChildren = nextProps.children;
	reconcilerChildren(wip, nextChildren);
}
