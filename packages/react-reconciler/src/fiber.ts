import { Key, Props, ReactElementType, Ref } from 'shared/ReactTypes';
import { FunctionComponent, HostComponent, WorkTag } from './workTags';
import { Flags, NoFlags } from './fiberFlags';
import { Container } from 'hostConfig';
import { __DEV__ } from './reconciler';
export class FiberNode {
	type: any;
	tag: WorkTag;
	pendingProps: Props;
	key: Key;
	stateNode: any;
	// ref: Ref;

	return: FiberNode | null;
	sibling: FiberNode | null;
	child: FiberNode | null;
	index: number;
	memoizedProps: Props | null;
	memoizedState: any;
	updateQueue: unknown;
	// memoizedState: any;
	alternate: FiberNode | null;
	flags: Flags;
	// subtreeFlags: Flags;

	constructor(tag: WorkTag, pendingProps: Props, key: Key) {
		this.tag = tag;
		this.pendingProps = pendingProps;
		this.key = key;

		this.stateNode = null; //此fiber对应的真实DOM节点  h1=>真实的h1DOM

		// fiber类型，来自于 虚拟DOM节点的type  span div p
		this.type = null;

		this.return = null; // 此fiber的父级fiber
		this.sibling = null; // 指向下一个兄弟fiber
		this.child = null; //指向第一个子节点
		this.index = 0; // 子节点的索引

		// 工作单元
		this.pendingProps = null; // 尚未进行计算的属性（新属性值未进行处理）
		this.memoizedProps = null; // 已处理的属性（已应用到真实DOM节点上的属性）
		this.memoizedState = null; // 已处理的状态（已应用到真实DOM节点上的状态）
		this.updateQueue = null; // 工作单元队列

		this.alternate = null; // 指向当前fiber的备份fiber
		// react实际有两个fiber树，一个是当前正在进行更改以待后续进行渲染的树，
		// 一个是备份树（已经渲染完成的树）。当渲染完成后，会将当前树赋值给备份树，
		// 而当前树则会被用于下一次渲染。

		/* this.flags  此fiber的副作用标记。标记该fiber是否有副作用。及副作用的类型，是要进行什么操作*/
		this.flags = NoFlags;
	}
}

export class FiberRootNode {
	container: Container;
	current: FiberNode;
	// 指向更新完成后的fiber树的根节点 也就是 hostRootFiber
	finishedWork: FiberNode | null;

	constructor(container: Container, hostRootFiber: FiberNode) {
		this.container = container;
		this.current = hostRootFiber;
		hostRootFiber.stateNode = this;
		this.finishedWork = null;
	}
}

export const createWorkInProgress = (
	current: FiberNode,
	pendingProps: Props
): FiberNode => {
	let wip = current.alternate;
	if (wip === null) {
		wip = new FiberNode(current.tag, pendingProps, current.key);
		wip.stateNode = current.stateNode;
		// 两棵树互相指向对方
		wip.alternate = current;
		current.alternate = wip;
	} else {
		// 更新的操作
		wip.pendingProps = pendingProps;
		// 重置副作用标记
		wip.flags = NoFlags;
	}
	wip.type = current.type;
	wip.updateQueue = current.updateQueue;
	wip.child = current.child;
	wip.memoizedProps = current.memoizedProps;
	wip.memoizedState = current.memoizedState;
	return wip;
};

export function createFiberFromElement(element: ReactElementType) {
	const { type, key, props } = element;
	let fiberTag: WorkTag = FunctionComponent;
	if (typeof type === 'string') {
		fiberTag = HostComponent;
	} else if (typeof type === 'function' && __DEV__) {
		console.warn('未定义的type类型', element);
	}
	const fiber = new FiberNode(fiberTag, props, key);
	return fiber;
}
