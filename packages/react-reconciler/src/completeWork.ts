import { FiberNode } from './fiber';
import { Fragment, FunctionComponent, HostComponent, HostRoot, HostText } from './workTags';
import { appendInitialChild, Container, createInstance, createTextInstance, updateFiberProps } from 'hostConfig';
import { NoFlags, Update } from './fiberFlags';

/**
 * 给 fiber 打上 Update 标记。commit 阶段检测到后会调用 commitUpdate 执行 DOM 属性更新。
 */
function markUpdate(fiber: FiberNode) {
	fiber.flags |= Update;
}

/**
 * completeWork 是 render 阶段"归"操作的入口。
 * 对应 beginWork 的逆过程，在向上回溯时为每个 fiber 创建 DOM 实例并组装子树。
 *
 * 处理逻辑（按 wip.tag）：
 * - HostComponent: mount → createInstance + appendAllChildren；update → TODO
 * - HostText: mount → createTextInstance；update → 比较新旧文本，不同则 markUpdate
 * - FunctionComponent / HostRoot: 仅 bubbleProperties（不创建 DOM）
 *
 * @param wip 当前正在处理的 workInProgress fiber
 */
export const completeWork = (wip: FiberNode) => {
	const newProps = wip.pendingProps;
	const current = wip.alternate;

	switch (wip.tag) {
		case HostComponent:
			if (current !== null && wip.stateNode) {
				//
				updateFiberProps(wip.stateNode, newProps);
				// 	TODO:更新
			} else {
				// 		构建Dom
				const instance = createInstance(wip.type, newProps);
				// 		将子节点及其兄弟节点加入到instance中
				appendAllChildren(instance, wip);
				wip.stateNode = instance;
			}
			bubbleProperties(wip);
			return null;
		case HostText:
			if (current !== null && wip.stateNode) {
				// 	更新的流程
				const oldText = current.memoizedProps.content;
				const newText = newProps.content;
				if (newText !== oldText) {
					markUpdate(wip);
				}
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
		case Fragment:
			bubbleProperties(wip);
			return null;
		default:
			if (__DEV__) {
				console.warn('未处理的completeWork情况', wip);
			}
	}
};

/**
 * 深度遍历 wip 的子 fiber 树，将所有 HostComponent / HostText 的 stateNode（真实 DOM）
 * 通过 appendInitialChild 挂载到 parent 元素下。
 *
 * 遇到 FunctionComponent 等非 DOM fiber 时跳过（继续向下钻取），
 * 因为 completeUnitOfWork 的遍历顺序是自底向上的，子 fiber 的 stateNode 已被创建。
 *
 * @param parent 父 DOM 元素（刚通过 createInstance 创建的）
 * @param wip 当前 fiber，遍历其 child 子树
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

/**
 * 找到儿子一级的所有的fiberNode，确定他们的subtreeFlags和flags，以此判断本级的subtreeFlags
 * 因为completeWork 是从下向上的，所以每次我们找下一级的就够了，
 * 因为下一级会在之前经过completeWork，也会找下一级的所有子节点，所以subtreeFlags实际上是以本节点为根的所有节点的副作用的集合
 * @param wip
 */
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
