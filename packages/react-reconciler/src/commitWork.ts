import { FiberNode, FiberRootNode } from './fiber';
import { MutationMask, NoFlags, Placement } from './fiberFlags';
import { HostComponent, HostRoot, HostText } from './workTags';
import { appendChildToContainer, Container } from 'hostConfig';

let nextEffect: FiberNode | null = null;

export const commitMutationEffect = (finishedWork: FiberNode) => {
	nextEffect = finishedWork;

	while (nextEffect !== null) {
		const child: FiberNode | null = nextEffect.child;
		// 向下钻
		if (
			(nextEffect.subtreeFlags & MutationMask) !== NoFlags &&
			child !== null
		) {
			nextEffect = child;
		} else {
			// 	钻到了叶子节点或者 subtreeFlags 确实为 NoFlags 的节点，但是这个节点的flags的值还不确定
			// 现在开始向上遍历
			up: while (nextEffect !== null) {
				commitMutationEffectOnFiber(nextEffect);
				const sibling: FiberNode | null = nextEffect.sibling;
				if (sibling !== null) {
					nextEffect = sibling;
					break up;
				}
				// 如果sibling为null，就向上
				nextEffect = nextEffect.return;
			}
		}
	}
};
// 在这里检查他的 flags 的值
const commitMutationEffectOnFiber = (finishedWork: FiberNode) => {
	const flags = finishedWork.flags;
	if ((flags & Placement) !== NoFlags) {
		commitPlacement(finishedWork);
		// 非运算相当于移除Placement标记
		finishedWork.flags &= ~Placement;
	}
	// 	flags update
	// 	flags ChildDeletion
};
const commitPlacement = (finishedWork: FiberNode) => {
	// 	这里我们就需要找到 它的父级的dom节点 以及 它本身的dom节点
	if (__DEV__) {
		console.warn('执行placement操作', finishedWork);
	}
	const hostParent = getHostParent(finishedWork);
	if (hostParent !== null) {
		appendPlacementNodeIntoContainer(finishedWork, hostParent);
	}
};
/**
 * 找到一个fiber的父级dom，可能会向上找几级
 * @param fiberNode
 */
const getHostParent = (fiberNode: FiberNode): Container | null => {
	let parent = fiberNode.return;

	while (parent !== null) {
		const parentTag = parent.tag;
		// 是HostComponent类型的节点（就是原生dom对应的fiberNode）他的stateNode指向 真实dom
		if (parentTag === HostComponent) {
			//
			return parent.stateNode;
		}
		// 虚拟根节点
		if (parentTag === HostRoot) {
			// 	他就需要向上找到根管理器上的container才是真的dom节点了
			return (parent.stateNode as FiberRootNode).container;
		}
		parent = parent.return;

		if (__DEV__) {
			console.warn('未找到host 的父节点dom');
		}
	}
	return null;
};

/**
 * 找到真实的dom节点对应的fiber，然后拿到真实的dom，再去进行操作
 * 同时把一层的都加上
 * @param finishedWork
 * @param hostParent
 */
function appendPlacementNodeIntoContainer(
	finishedWork: FiberNode,
	hostParent: Container
) {
	if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
		appendChildToContainer(hostParent, finishedWork.stateNode);
		// 这里之所以直接return，是因为在 complete 阶段，其实子节点基本都已经挂到
		return;
	}
	// 说明不是HostComponent、HostText
	// 则要向下找
	const child = finishedWork.child;
	if (child !== null) {
		appendPlacementNodeIntoContainer(child, hostParent);
		let sibling = child.sibling;
		while (sibling !== null) {
			appendPlacementNodeIntoContainer(sibling, hostParent);
			sibling = sibling.sibling;
		}
	}
}
