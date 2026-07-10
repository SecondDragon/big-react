import { FiberNode } from './fiber';
import {
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';
import {
	appendInitialChild,
	Container,
	createInstance,
	createTextInstance
} from 'hostConfig';
import { NoFlags } from './fiberFlags';

export const completeWork = (wip: FiberNode) => {
	const newProps = wip.pendingProps;
	const current = wip.alternate;

	switch (wip.tag) {
		case HostComponent:
			if (current !== null && wip.stateNode) {
				// 	TODO:更新
			} else {
				// 		构建Dom
				const instance = createInstance(wip.type);
				// 		将子节点及其兄弟节点加入到instance中
				appendAllChildren(instance, wip);
				wip.stateNode = instance;
			}
			bubbleProperties(wip);
			return null;
		case HostText:
			if (current !== null && wip.stateNode) {
				console.log();
			} else {
				// 		构建Dom,HostText的 type 是null,所以应该使用他的newProps.content来构建
				// 创建文本节点
				const instance = createTextInstance(newProps.content);
				wip.stateNode = instance;
				// 		将Dom插入Dom树中
			}
			bubbleProperties(wip);
			return null;
		case HostRoot:
			// 		构建Dom,
			// 		将Dom插入Dom树中
			if (current !== null && wip.stateNode) {
				console.log();
			}

			bubbleProperties(wip);
			return null;
		case FunctionComponent:
			bubbleProperties(wip);
			return null;
		default:
			if (__DEV__) {
				console.warn('未处理的completeWork情况', wip);
			}
	}
};

/**
 * 旨在找到我们parent节点的子节点的dom，可能是函数等计算节点，这些节点没有真实dom，需要跳过继续下探
 * 如果探到了，还要找兄弟节点，
 * 实际上和beginWork,completeWork 一样，遍历执行获取
 * @param parent
 * @param wip
 */
export function appendAllChildren(parent: Container, wip: FiberNode) {
	let node = wip.child;
	while (node !== null) {
		if (node.tag === HostComponent || node.tag === HostText) {
			appendInitialChild(parent, node?.stateNode);
		} else if (node.child !== null) {
			node.child.return = node;
			node = node.child;
			continue;
		}
		if (node === wip) {
			return;
		}
		// 没有兄弟就向上找
		while (node.sibling === null) {
			if (node.return === null || node.return === wip) {
				return;
			}
			node = node?.return;
		}
		node.sibling.return = node.return;
		node = node.sibling;
	}
}

function bubbleProperties(wip: FiberNode) {
	let subtreeFlags = NoFlags;
	let child = wip.child;

	while (child !== null) {
		subtreeFlags |= child.subtreeFlags;
		subtreeFlags |= child.flags;

		child.return = wip;
		child = child.sibling;
	}
	wip.subtreeFlags |= subtreeFlags;
}
