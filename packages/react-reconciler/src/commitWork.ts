import { FiberNode, FiberRootNode } from './fiber';
import {
	ChildDeletion,
	MutationMask,
	NoFlags,
	Placement,
	Update
} from './fiberFlags';
import {
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';
import {
	appendChildToContainer,
	commitUpdate,
	Container,
	insertChildToContainer,
	Instance,
	removeChild
} from 'hostConfig';

let nextEffect: FiberNode | null = null;

/**
 * commit 阶段 Mutation 子阶段的入口。
 * 深度优先遍历 finishedWork fiber 树，对每个有 MutationMask 标记的节点
 * 执行 commitMutationEffectOnFiber。
 *
 * 遍历策略：
 * 1. 优先向下钻取（检查 subtreeFlags & MutationMask）
 * 2. 到底后处理当前节点，然后找 sibling
 * 3. 无 sibling 则向上回溯
 *
 * @param finishedWork 构建完成的 HostRoot fiber
 */
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

	if ((flags & Update) !== NoFlags) {
		commitUpdate(finishedWork);
		// 非运算相当于移除Update标记
		finishedWork.flags &= ~Update;
	}
	if ((flags & ChildDeletion) !== NoFlags) {
		const deletions = finishedWork.deletions;
		if (deletions !== null) {
			deletions.forEach((childToDelete) => {
				commitDeletion(childToDelete);
			});
		}
		// 非运算相当于移除ChildDeletion标记
		finishedWork.flags &= ~ChildDeletion;
	}
	// 	flags update
	// 	flags ChildDeletion
};

/**
 * 收集子树中需要从父 DOM 中移除的 Host fiber。
 *
 * 核心逻辑：只收集与上一个已收集节点在 fiber sibling 链上相连的 Host 节点。
 * 目的是跳过 FunctionComponent 内部嵌套的 Host 节点——这些节点无法通过一次
 * sibling 遍历到达，且它们可能共用同一个祖先 DOM，后续会被其他机制处理。
 *
 * 配合 Fragment 就能正常工作：
 *
 * fiber 树（Fragment 场景）：
 *   ul (删除目标)
 *     └── Fragment (tag=7)
 *           ├── li#1 (HostComponent)  ← sibling 链上连通
 *           ├── li#2 (HostComponent)  ← 同上
 *           └── li#3 (HostComponent)  ← 同上
 *
 * commitNestedComponent 遍历顺序：
 *   ul → Fragment → li#1 → li#2 → li#3
 *
 * recordHostChildrenToDelete 执行过程：
 *   ① li#1：childrenToDelete 为空 → 直接 push，得到 [li#1]
 *   ② li#2：从 li#1.sibling 出发 → li#1.sibling = li#2 → 找到，push → [li#1, li#2]
 *   ③ li#3：从 li#1.sibling 出发 → li#1.sibling = li#2, li#2.sibling = li#3 → 找到，push → [li#1, li#2, li#3]
 *   ✅ 全部收集成功，后续从 <ul> 中逐个 removeChild
 *
 * fiber 树（无 Fragment，FunctionComponent 嵌套）：
 *   div (删除目标)
 *     ├── p#1 (HostComponent)
 *     ├── Child (FunctionComponent)
 *     │     └── span (HostText)       ← 不在 p#1 的 sibling 链上
 *     └── p#2 (HostComponent)
 *
 * commitNestedComponent 遍历顺序：
 *   div → p#1 → Child → span → p#2
 *
 * recordHostChildrenToDelete 执行过程：
 *   ① p#1：childrenToDelete 为空 → 直接 push，得到 [p#1]
 *   ② span：从 p#1.sibling 出发 → p#1.sibling = Child，不是 span → 找不到，跳过 ❌
 *   ③ p#2：从 p#1.sibling 出发 → p#1.sibling = Child, Child.sibling = p#2 → 找到，push → [p#1, p#2]
 *   ⚠️ span 被遗漏，它的 stateNode 不会被 removeChild
 *   这意味着 FunctionComponent 子节点内部的宿主节点（如 span）无法被正确清理。
 *   这也是为什么 Fiber 树中推荐将 FunctionComponent 的多个兄弟节点用 Fragment 包裹的原因之一。
 *
 * @param childrenToDelete 收集结果的数组
 * @param unmountFiber 遍历到的 fiber，可能是 HostComponent / HostText
 */
function recordHostChildrenToDelete(
	childrenToDelete: FiberNode[],
	unmountFiber: FiberNode
) {
	const lastOne = childrenToDelete[childrenToDelete.length - 1];

	if (!lastOne) {
		childrenToDelete.push(unmountFiber);
	} else {
		let node = lastOne.sibling;
		while (node !== null) {
			if (node === unmountFiber) {
				childrenToDelete.push(unmountFiber);
			}
			node = node.sibling;
		}
	}
}

/**
 * 删除 fiber 子树，从父 DOM 中移除所有对应的真实 DOM 节点。
 *
 * 执行流程：
 * 1. 通过 commitNestedComponent 深度优先遍历整棵子树
 * 2. 对每个 HostComponent / HostText 调用 recordHostChildrenToDelete 收集
 * 3. 根据收集结果，从 getHostParent(childToDelete) 找到的父 DOM 容器中 removeChild
 *
 * ─── 场景 A ──────────────────────────────────
 * childToDelete 是 ul（HostComponent），例如：
 *   <div id="root">
 *     <ul>
 *       <li>1</li>
 *       <li>2</li>
 *       <li>3</li>
 *     </ul>
 *   </div>
 *
 * fiber 树（childToDelete = ul）：
 *   ul (HostComponent, stateNode = <ul>)
 *     └── Fragment (tag=7)
 *           ├── li#1 (HostComponent)
 *           │     └── "1" (HostText)
 *           ├── li#2 (HostComponent)
 *           │     └── "2" (HostText)
 *           └── li#3 (HostComponent)
 *                 └── "3" (HostText)
 *
 * commitNestedComponent 遍历：ul → Fragment → li#1 → "1" → li#2 → "2" → li#3 → "3"
 *
 * recordHostChildrenToDelete 收集过程：
 *  ① ul：rootChildrenToDelete 为空 → push ul → [ul]
 *  ② li#1：lastOne = ul，ul.sibling = null → li#1 NOT 收集 ❌
 *  ③ 后续所有 li / text 同理被跳过
 *
 * rootChildrenToDelete = [ul]
 * getHostParent(ul) → ul.return 向上直到 HostRoot → 返回 <div id="root">
 *
 * 最终删除：
 *   removeChild(<ul>, <div id="root">)
 *   ✅ 直接把整个 <ul> 从 DOM 中移除
 *
 * ─── 场景 B ──────────────────────────────────
 * childToDelete 是 Fragment（当 Fragment 作为外层节点被删除时）：
 *
 * fiber 树（childToDelete = Fragment）：
 *   ul (HostComponent, stateNode = <ul>)
 *     └── Fragment (tag=7)  ← childToDelete
 *           ├── li#1 (HostComponent, stateNode = <li>1</li>)
 *           │     └── "1" (HostText)
 *           ├── li#2 (HostComponent, stateNode = <li>2</li>)
 *           │     └── "2" (HostText)
 *           └── li#3 (HostComponent, stateNode = <li>3</li>)
 *                 └── "3" (HostText)
 *
 * commitNestedComponent 遍历：Fragment → li#1 → "1" → li#2 → "2" → li#3 → "3"
 *
 * recordHostChildrenToDelete 收集过程：
 *  ① Fragment：tag=7 → default → 什么都不做
 *  ② li#1：rootChildrenToDelete 为空 → push li#1 → [li#1]
 *  ③ "1"：lastOne = li#1，li#1.sibling = li#2，li#2 !== "1" → NOT 收集 ❌
 *  ④ li#2：lastOne = li#1，li#1.sibling = li#2，li#2 === li#2 → push → [li#1, li#2]
 *  ⑤ "2"：lastOne = li#2，li#2.sibling = li#3，li#3 !== "2" → NOT 收集 ❌
 *  ⑥ li#3：lastOne = li#2，li#2.sibling = li#3，li#3 === li#3 → push → [li#1, li#2, li#3]
 *  ⑦ "3"：lastOne = li#3，li#3.sibling = null → NOT 收集 ❌
 *
 * rootChildrenToDelete = [li#1, li#2, li#3]
 * getHostParent(Fragment) → Fragment.return = ul (HostComponent) → 返回 <ul>
 *
 * 最终删除：
 *   removeChild(<li>1</li>, <ul>)
 *   removeChild(<li>2</li>, <ul>)
 *   removeChild(<li>3</li>, <ul>)
 *   ✅ Fragment 本身无 DOM，逐个移除其子 Host 节点（它们确实是 <ul> 的直接子 DOM）
 *
 * 核心结论：当 childToDelete 本身是 HostComponent 时直接 removeChild 它自己；
 * 当 childToDelete 是非 DOM 节点（Fragment / FunctionComponent）时，
 * 需要逐个移除其顶层 Host 子节点。
 *
 * @param childToDelete 需要被删除的子 fiber（已被父 fiber 的 deletions 数组引用）
 */
function commitDeletion(childToDelete: FiberNode) {
	const rootChildrenToDelete: FiberNode[] = [];

	commitNestedComponent(childToDelete, (unmountFiber) => {
		switch (unmountFiber.tag) {
			case HostComponent:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				// TODO:解绑ref
				return;
			case HostText:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				return;
			case FunctionComponent:
				// TODO:useEffect unmount的处理
				return;
			default:
				if (__DEV__) {
					console.warn('未处理的unmount类型', unmountFiber);
				}
		}
	});

	if (rootChildrenToDelete.length !== 0) {
		const hostParent = getHostParent(childToDelete);
		if (hostParent !== null) {
			rootChildrenToDelete.forEach((node) => {
				removeChild((node as FiberNode).stateNode, hostParent);
			});
		}
	}

	childToDelete.return = null;
	childToDelete.child = null;
}

/**
 * 深度优先遍历整棵 fiber 子树，在每个节点上调用 onCommitUnmount 回调。
 * 用于 commitDeletion 中逐个 fiber 执行卸载前的清理工作（收集 Host DOM / 未来解绑 ref / 触发 useEffect cleanup）。
 *
 * 遍历策略：标准的向下钻 + 水平移 + 向上回溯。
 *
 * 以 Fragment 场景为例：
 *   ul (删除目标)
 *     └── Fragment (tag=7)
 *           ├── li#1 (HostComponent)
 *           │     └── "1" (HostText)
 *           ├── li#2 (HostComponent)
 *           │     └── "2" (HostText)
 *           └── li#3 (HostComponent)
 *                 └── "3" (HostText)
 *
 * 遍历顺序：
 *   步骤  node          child?  sibling?  ↑/↓
 *   ─────────────────────────────────────────────
 *    ①   ul            → Fragment              回调:unmount(ul)
 *    ②   Fragment      → li#1                  回调:unmount(Fragment)
 *    ③   li#1          → "1"                   回调:unmount(li#1)
 *    ④   "1"           null    null             回调:unmount("1"), node!=root
 *                       └─向上: return=li#1, li#1.sibling=li#2 → 水平到 li#2
 *    ⑤   li#2          → "2"                   回调:unmount(li#2)
 *    ⑥   "2"           null    null
 *                       └─向上: return=li#2, li#2.sibling=li#3 → 水平到 li#3
 *    ⑦   li#3          → "3"                   回调:unmount(li#3)
 *    ⑧   "3"           null    null
 *                       └─向上: return=li#3, li#3.sibling=null
 *                         └─再向上: return=Fragment, Fragment.return=ul=root
 *                           └─回到 root → 结束
 *
 * @param root 子树的根 fiber（childToDelete）
 * @param onCommitUnmount 对每个 fiber 执行的回调
 */
function commitNestedComponent(
	root: FiberNode,
	onCommitUnmount: (fiber: FiberNode) => void
) {
	let node = root;
	while (true) {
		onCommitUnmount(node);
		// 向下钻：只要有 child 就继续深入
		if (node.child !== null) {
			node.child.return = node;
			node = node.child;
			continue;
		}
		// 回到根节点 → 遍历完成
		if (node === root) {
			return;
		}
		// 无 sibling → 向上回溯
		while (node.sibling === null) {
			if (node.return === null || node.return === root) return;
			node = node.return;
		}
		// 有 sibling → 水平移动
		node.sibling.return = node.return;
		node = node.sibling;
	}
}

/**
 * 执行 Placement 操作：将 finishedWork 及其子树插入到 DOM 中。
 * 1. 通过 getHostParent 向上找到最近的 HostComponent 或 HostRoot 对应的 DOM 父节点
 * 2. 通过 getHostSibling 获取参考的兄弟 DOM 节点
 * 3. 通过 insertOrAppendPlacementNodeIntoContainer 将子树 DOM 插入（有兄弟参考）或追加到父节点
 *
 * @param finishedWork 带有 Placement 标记的 fiber
 */
const commitPlacement = (finishedWork: FiberNode) => {
	// 	这里我们就需要找到 它的父级的dom节点 以及 它本身的dom节点
	if (__DEV__) {
		console.warn('执行Placement操作', finishedWork);
	}
	// parent DOM
	const hostParent = getHostParent(finishedWork);

	// host sibling
	const sibling = getHostSibling(finishedWork);

	// finishedWork ~~ DOM append parent DOM
	if (hostParent !== null) {
		insertOrAppendPlacementNodeIntoContainer(finishedWork, hostParent, sibling);
	}
};

/**
 * 找到这个 fiber 的 DOM 节点在真实 DOM 树中的兄弟节点。
 * 由于 fiber 树中存在非 DOM 类型的节点（如 FunctionComponent），
 * 其对应的真实 DOM 可能在子 fiber 中，因此需要跨 fiber 边界查找。
 *
 * 查找策略：
 * 1. 当前 fiber 无同级 fiber → 向上回溯，直到找到有兄弟 fiber 的祖先。
 *    若祖先为 HostComponent / HostRoot 仍无兄弟 → 返回 null（插入到末尾）。
 * 2. 找到兄弟 fiber 后，若其类型不是 HostComponent / HostText（如 FunctionComponent），
 *    向下钻取找到第一个 HostComponent / HostText 子节点。
 * 3. 若该兄弟或其子孙 fiber 带有 Placement 标记 → 跳过（该节点本身也要被插入），
 *    继续查找下一个兄弟。
 *
 * 举例说明：
 * <App>
 *   <div />
 *   <Child />
 * </App>
 * function Child() {
 *   return <span />
 * }
 *
 * div 的 fiber 有兄弟 fiber（Child），但 Child 不是 DOM 节点，
 * 需要向下找到 span fiber，取 span.stateNode 作为真实的兄弟 DOM 节点。
 *
 * 相反：
 * <App>
 *   <Child />
 *   <div />
 * </App>
 *
 * 当 span 需要找兄弟 DOM 时，span fiber 无同级 fiber，
 * 向上找到 Child fiber，Child 有兄弟 div fiber，返回 div.stateNode。
 *
 * @param fiber 带有 Placement 标记的 fiber
 * @returns 目标兄弟 DOM 节点，或 null（插入到父节点末尾）
 */
function getHostSibling(fiber: FiberNode) {
	let node: FiberNode = fiber;

	findSibling: while (true) {
		while (node.sibling === null) {
			const parent = node.return;

			if (
				parent === null ||
				parent.tag === HostComponent ||
				parent.tag === HostRoot
			) {
				return null;
			}
			// 向上遍历
			node = parent;
		}
		node.sibling.return = node.return;
		node = node.sibling;

		while (node.tag !== HostText && node.tag !== HostComponent) {
			// 向下遍历
			if ((node.flags & Placement) !== NoFlags) {
				continue findSibling;
			}
			if (node.child === null) {
				continue findSibling;
			} else {
				node.child.return = node;
				node = node.child;
			}
		}

		if ((node.flags & Placement) === NoFlags) {
			return node.stateNode;
		}
	}
}

/**
 * 向上查找 fiber 链中最近的 DOM 祖先节点。
 *
 * 由于 fiber 树中存在非 DOM 类型的节点（Fragment / FunctionComponent），
 * 一个 fiber 的 return 链上可能有若干层非 DOM 节点，需要跳过它们，
 * 找到最近的 HostComponent（其 stateNode 就是真实 DOM）或 HostRoot。
 *
 * ─── 场景 A：commitDeletion 中 childToDelete = Fragment ────────
 * fiber 树：
 *   ul (HostComponent, stateNode = <ul>)
 *     └── Fragment (tag=7)  ← getHostParent 起点
 *           ├── li#1
 *           └── li#2
 *
 * 向上查找：
 *   Fragment.return = ul (HostComponent) → 直接返回 ul.stateNode = <ul>
 *
 * ─── 场景 B：commitDeletion 中 childToDelete = FunctionComponent ──
 * fiber 树：
 *   div (HostComponent, stateNode = <div>)
 *     └── Child (FunctionComponent)  ← getHostParent 起点
 *           └── span (HostText, stateNode = <span>text</span>)
 *
 * 向上查找：
 *   Child.return = div (HostComponent) → 返回 div.stateNode = <div>
 *
 * ─── 场景 C：commitPlacement 中 finishedWork = FunctionComponent ──
 * <div id="root">
 *   <App />  ← 要 placement，但其 fiber 无对应 DOM
 * </div>
 *
 * fiber 树：
 *   HostRoot (stateNode = FiberRootNode)
 *     └── App (FunctionComponent)  ← getHostParent 起点
 *           └── span
 *
 * 向上查找：
 *   App.return = HostRoot → HostRoot.stateNode = FiberRootNode
 *   返回 FiberRootNode.container = <div id="root">
 *
 * @param fiberNode 任意 fiber（HostComponent / HostText / Fragment / FunctionComponent 均可）
 * @returns 最近的 DOM 祖先节点，或 null（异常情况）
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
	}
	if (__DEV__) {
		console.warn('未找到host 的父节点dom');
	}
	return null;
};

/**
 * 将被标记 Placement 的 fiber 对应的 DOM 节点插入/追加到 hostParent 中。
 *
 * 分两种情况处理：
 *
 * ─── 情况 A：finishedWork 本身是 HostComponent / HostText ─────
 *      它有 stateNode（真实 DOM），且 completeWork 中的 appendAllChildren
 *      已将子树的所有 DOM 都挂载到它的 stateNode 下。所以直接插入这一个 DOM：
 *        - 有 before → insertBefore
 *        - 无 before → appendChild
 *      插入完毕后 return，不递归子树。
 *
 * ─── 情况 B：finishedWork 是非 DOM 类型（FunctionComponent / Fragment）─
 *      它没有 stateNode，DOM 节点在 child 子树的各个 Host 节点上。
 *      需要递归遍历 child 子树，找到所有直属的 Host 节点逐个插入。
 *
 *      举例：<App><li>1</li><li>2</li><li>3</li></App>
 *
 *      fiber 树：
 *        App (FunctionComponent) ← finishedWork
 *          └── Fragment (tag=7)
 *                ├── li#1 (HostComponent, stateNode = <li>1</li>)
 *                ├── li#2 (HostComponent, stateNode = <li>2</li>)
 *                └── li#3 (HostComponent, stateNode = <li>3</li>)
 *
 *      ① insertOrAppend(App, hostParent)
 *         App 不是 DOM 类型 → 取 child = Fragment
 *      ② insertOrAppend(Fragment, hostParent)
 *         Fragment 不是 DOM 类型 → 取 child = li#1
 *      ③ insertOrAppend(li#1, hostParent)
 *         li#1 是 HostComponent → appendChild(<li>1</li>, hostParent)  ✅
 *      ④ 回到 ② 的 sibling 循环 → li#2
 *      ⑤ insertOrAppend(li#2, hostParent)
 *         li#2 是 HostComponent → appendChild(<li>2</li>, hostParent)  ✅
 *      ⑥ 回到 ② 的 sibling 循环 → li#3
 *      ⑦ insertOrAppend(li#3, hostParent)
 *         li#3 是 HostComponent → appendChild(<li>3</li>, hostParent)  ✅
 *
 *      效果：三个 <li> 被依次追加到 hostParent 下。
 *
 *      注意：非 DOM 类型的递归路径中不传递 before 参数，
 *      因为外部调用（commitPlacement）拿到的 before 是相对于
 *      finishedWork 这一个 fiber 的同级参考节点。递归到内部之后，
 *      相对顺序由 completeWork 的 DOM 组装 + 最终的 append 顺序保证。
 *
 * @param finishedWork 当前正在处理的 fiber（带 Placement 标记）
 * @param hostParent 目标父 DOM 节点
 * @param before 可选的兄弟 DOM 引用节点，仅当 finishedWork 为 Host 时传入
 */
function insertOrAppendPlacementNodeIntoContainer(
	finishedWork: FiberNode,
	hostParent: Container,
	before?: Instance
) {
	if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
		if (before) {
			insertChildToContainer(finishedWork.stateNode, hostParent, before);
		} else {
			appendChildToContainer(hostParent, finishedWork.stateNode);
		}
		return;
	}
	// 非 DOM 类型 fiber，递归向下找实际的 DOM 节点
	const child = finishedWork.child;
	if (child !== null) {
		insertOrAppendPlacementNodeIntoContainer(child, hostParent);
		let sibling = child.sibling;
		while (sibling !== null) {
			insertOrAppendPlacementNodeIntoContainer(sibling, hostParent);
			sibling = sibling.sibling;
		}
	}
}
