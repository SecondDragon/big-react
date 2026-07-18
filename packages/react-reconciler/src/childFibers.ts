import {
	createFiberFromElement,
	createFiberFromFragment,
	createWorkInProgress,
	FiberNode
} from './fiber';
import { Key, Props, ReactElementType } from 'shared/ReactTypes';
import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';
import { Fragment, HostText } from './workTags';
import { ChildDeletion, Placement } from './fiberFlags';

type ExistingChildren = Map<string | number, FiberNode>;

/**
 * ChildReconciler 工厂函数。根据 shouldTrackEffects 生成 mount 或 update 用的 reconciler。
 *
 * mountChildFibers(shouldTrackEffects=false)：
 *   - 不标记 Placement，离屏构建 DOM 后由根节点一次性挂载
 *   - deleteChild / deleteRemainingChildren 直接 return，不做任何删除标记
 *
 * reconcileChildFibers(shouldTrackEffects=true)：
 *   - 标记 Placement（新建/移动）/ ChildDeletion（删除）
 *   - 生成的 fiber 最终在 commit 阶段由 MutationMask 处理
 *
 * @param shouldTrackEffects true → 更新流程，标记副作用；false → mount 流程，不标记
 */
function ChildReconciler(shouldTrackEffects: boolean) {
	/**
	 * 标记一个子 fiber 需要被删除。
	 * 添加到父 fiber 的 deletions 数组，并在 flags 上置 ChildDeletion 位。
	 * 只在 shouldTrackEffects 为 true 时生效。
	 * @param returnFiber 父 fiber
	 * @param childToDelete 待删除的子 fiber
	 */
	function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode) {
		if (!shouldTrackEffects) {
			return;
		}
		const deletions = returnFiber.deletions;
		if (deletions === null) {
			returnFiber.deletions = [childToDelete];
			returnFiber.flags |= ChildDeletion;
		} else {
			deletions.push(childToDelete);
			// returnFiber.flags |= ChildDeletion;
		}
	}

	/**
	 * 将某个节点及其所有后续兄弟节点全部标记为删除。
	 *
	 * 在 reconcileSingleElement / reconcileSingleTextNode 中，
	 * 找到可复用的节点后，它的后续兄弟都是旧树中需要被删除的节点。
	 *
	 * 举例（update 场景）：
	 *   current sibling 链：li#1(key='a'), li#2(key='b'), li#3(key='c')
	 *   新 children：<div>new</div>（type 变了，不再是 li）
	 *   调用 deleteRemainingChildren(returnFiber, li#1)
	 *   → li#1, li#2, li#3 全部标记 ChildDeletion
	 *
	 * @param returnFiber 父 fiber
	 * @param currentFirstChild 从此节点开始删除（含自身），null 则什么都不做
	 */
	function deleteRemainingChildren(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode | null
	) {
		if (!shouldTrackEffects) {
			// 不需要追踪时，其实就是mount时，完全没必要
			return;
		}
		let childToDelete = currentFirstChild;
		while (childToDelete !== null) {
			deleteChild(returnFiber, childToDelete);
			childToDelete = childToDelete.sibling;
		}
	}

	/**
	 * 协调单个 ReactElement 子节点（单节点 diff）。
	 *
	 * 决策逻辑（按优先级）：
	 *   1. key 相同 + type 相同 → 复用旧 fiber（useFiber），只更新 props
	 *   2. key 相同 + type 不同 → 删除所有旧的，创建新 fiber
	 *   3. key 不同 → 删除旧的，继续检查下一个兄弟
	 *   4. currentFiber 为 null（mount）→ 直接创建新 fiber
	 *
	 * 举例（update 场景）：
	 *   current sibling 链：div(key='a'), span(key='b')
	 *   新 element：<div key="a">new</div>
	 *
	 *   处理过程：
	 *   ① i=0, current=div(key='a'): key 相同, type 相同(div===div)
	 *      → useFiber(div, {children:'new'}) 复用
	 *      → deleteRemainingChildren(returnFiber, div.sibling) 删除 span
	 *      → 返回复用的 fiber
	 *
	 * @param returnFiber 当前正在处理（beginWork）的 wip fiber
	 * @param currentFiber 旧树上对应的子 fiber（来自 current.child），mount 时为 null
	 * @param element 新的 ReactElement（来自 jsxDEV 编译产物 或 组件函数返回值）
	 */
	function reconcileSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		element: ReactElementType
	) {
		//
		const key = element.key;
		while (currentFiber !== null) {
			if (currentFiber.key === key) {
				// 	key相同
				if (element.$$typeof === REACT_ELEMENT_TYPE) {
					if (currentFiber.type === element.type) {
						// 	type 相同
						console.log('Reconciling single element,复用fiber:', currentFiber);
						console.log(
							'Reconciling single element,element:',
							element,
							element.props
						);
						let props = element.props;

						if (element.type === REACT_FRAGMENT_TYPE) {
							// 进入此分支的场景（reconcileSingleElement 处理到 type 相同的逻辑）：
							// 1. 函数组件返回单个 Fragment：return <><li>1</li><li>2</li></>
							//    此时 reconcilerChildFibers 拿到的 newChild 是
							//    { $$typeof: REACT_ELEMENT_TYPE, type: REACT_FRAGMENT_TYPE, props: { children: [...] } }
							// 2. HostComponent 的 children 是单个 Fragment：<div><>text</></div>
							// 3. 条件渲染中 Fragment 作为值：return cond ? <span>a</span> : <><span>b</span></>
							props = element.props.children;
						}

						const existing = useFiber(currentFiber, props);
						existing.return = returnFiber;
						// 标记当前节点的下一个兄弟节点及其后续节点为删除 (这逻辑不对吧)
						deleteRemainingChildren(returnFiber, currentFiber.sibling);
						return existing;
					}
					// key相同type不同，删除所有旧的
					deleteRemainingChildren(returnFiber, currentFiber);
					break;
				} else {
					if (__DEV__) {
						console.warn('还未实现的react类型', element);
						break;
					}
				}
			} else {
				// 删掉旧的
				deleteChild(returnFiber, currentFiber);
				currentFiber = currentFiber.sibling;
			}
		}
		// 遍历完没return，就创建新的fiber节点

		let fiber;
		if (element.type === REACT_FRAGMENT_TYPE) {
			fiber = createFiberFromFragment(element.props.children, key);
		} else {
			fiber = createFiberFromElement(element);
		}

		fiber.return = returnFiber;
		return fiber;
	}
	/**
	 * 协调单个文本/数字子节点（单节点 diff 的文本特化版本）。
	 *
	 * 如果旧 fiber 也是 HostText → 复用并更新 content。
	 * 否则 → 删除旧的，新建 HostText fiber。
	 *
	 * 举例（update 场景）：
	 *   <div>old</div> → <div>new</div>
	 *
	 *   current sibling 链：Text("old")(HostText)
	 *   新 content："new"
	 *
	 *   处理过程：
	 *   current=Text("old"), tag === HostText → useFiber(current, {content:'new'}) 复用
	 *
	 * @param returnFiber 当前 wip fiber
	 * @param currentFiber 旧树上的子 fiber
	 * @param content 文本/数字内容（来自 ReactElement.props.children 的原始值）
	 */
	function reconcileSingleTextNode(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		content: string | number
	) {
		while (currentFiber !== null) {
			if (currentFiber.tag === HostText) {
				// 	类型没变
				console.log(
					'Reconciling single element,复用currentFiber:',
					currentFiber,
					'content',
					content
				);
				const existing = useFiber(currentFiber, { content });
				existing.return = returnFiber;
				deleteRemainingChildren(returnFiber, currentFiber.sibling);
				return existing;
			}
			// 删除旧的
			deleteChild(returnFiber, currentFiber);
			currentFiber = currentFiber.sibling;
		}
		// 都不能复用 创建新的
		const fiber = new FiberNode(HostText, { content }, null);
		fiber.return = returnFiber;
		return fiber;
	}

	/**
	 * 为新建的 fiber 打上 Placement 标记。
	 * 条件：shouldTrackEffects 为 true 且 fiber 是全新创建的（alternate === null）。
	 * 这两个条件同时满足 = 更新流程中新增了一个节点 → 需要 commit 阶段插入 DOM。
	 */
	function placeSingleChild(fiber: FiberNode) {
		if (shouldTrackEffects && fiber.alternate === null) {
			fiber.flags |= Placement;
		}
		return fiber;
	}

	/**
	 * 协调数组类型的子节点（多节点 diff）。
	 *
	 * 执行流程：
	 * 1. 将 current fiber 的同级节点存入 Map（key 或 index 作为键）
	 * 2. 遍历 newChild 数组，通过 updateFromMap 查找可复用的 fiber
	 * 3. 根据 oldIndex 与 lastPlacedIndex 比较标记 Placement（移动）或不动
	 * 4. 将 Map 中未被复用的旧 fiber 标记为删除
	 *
	 * 举例：旧 [li(k='1'), li(k='2'), li(k='3')] → 新 [li(k='3'), li(k='2'), li(k='1')]
	 *
	 * 旧 fiber 树（current）：
	 *   key='1'(index=0), key='2'(index=1), key='3'(index=2)
	 *
	 * 新 children：
	 *   [{type:'li',key:'3'}, {type:'li',key:'2'}, {type:'li',key:'1'}]
	 *
	 * diff 过程：
	 *   i=0, li(k='3'): oldIndex=2 >= lastPlacedIndex=0 → 不移动, lastPlacedIndex=2
	 *   i=1, li(k='2'): oldIndex=1 <  lastPlacedIndex=2 → 标记 Placement（移动）
	 *   i=2, li(k='1'): oldIndex=0 <  lastPlacedIndex=2 → 标记 Placement（移动）
	 *   Map 中无剩余 → 无删除
	 *
	 * @param returnFiber 当前 wip fiber
	 * @param currentFirstChild 旧树上第一个子 fiber（current.child）
	 * @param newChild 新的子节点数组（来自 ReactElement.props.children）
	 * @returns 新 fiber 链表的头节点（firstNewFiber）
	 */
	function reconcileChildrenArray(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode | null,
		newChild: any[]
	) {
		let lastPlacedIndex = 0;
		let lastNewFiber: FiberNode | null = null;
		let firstNewFiber: FiberNode | null = null;

		// 1. 将 current sibling 链存入 Map，用于后续 O(1) 查找
		const existingChildren: ExistingChildren = new Map();
		let current = currentFirstChild;
		while (current !== null) {
			const keyToUse = current.key !== null ? current.key : current.index;
			existingChildren.set(keyToUse, current);
			current = current.sibling;
		}

		for (let i = 0; i < newChild.length; i++) {
			// 2. 遍历 newChild，从 Map 中查找可复用的 fiber
			const after = newChild[i];

			const newFiber = updateFromMap(returnFiber, existingChildren, i, after);
			if (newFiber === null) {
				continue;
			}

			// 3. 构建新 fiber 链表的 sibling 关系
			newFiber.index = i;
			newFiber.return = returnFiber;

			if (lastNewFiber === null) {
				lastNewFiber = newFiber;
				firstNewFiber = newFiber;
			} else {
				lastNewFiber.sibling = newFiber;
				lastNewFiber = lastNewFiber.sibling;
			}

			if (!shouldTrackEffects) {
				continue;
			}

			const current = newFiber.alternate;
			if (current !== null) {
				// 有 alternate → 复用旧 fiber，判断是否需要移动
				const oldIndex = current.index;

				// oldIndex < lastPlacedIndex：旧次序比已确定不动的节点更靠左，
				// 在新列表中它出现在更靠右的位置 → 需要移动
				if (oldIndex < lastPlacedIndex) {
					newFiber.flags |= Placement;
					console.log('reconcileChildrenArray,移动:', newFiber);
					continue;
				} else {
					lastPlacedIndex = oldIndex;
					console.log('reconcileChildrenArray,不移动:', newFiber);
				}
			} else {
				// 无 alternate → 全新节点，需要插入
				newFiber.flags |= Placement;
				console.log('reconcileChildrenArray,插入:', newFiber);
			}
		}
		// 4. Map 中剩余的旧 fiber 标记为删除
		existingChildren.forEach((fiber: FiberNode) => {
			deleteChild(returnFiber, fiber);
		});

		return firstNewFiber;
	}

	/**
	 * 对外暴露的协调入口函数。根据 newChild 的类型分发到不同的 reconciler。
	 *
	 * 入口处先对无 key 的顶层 Fragment 做展开（isUnkeyedTopLevelFragment），
	 * 将 Fragment.props.children 提升为 newChild，使得 Fragment 不占用 fiber 节点。
	 *
	 * 分发逻辑：
	 *   - 数组 → reconcileChildrenArray（多节点 diff）
	 *   - ReactElement → reconcileSingleElement → placeSingleChild（单节点 diff）
	 *   - 字符串/数字 → reconcileSingleTextNode → placeSingleChild（文本 diff）
	 *   - 其他 → 删除旧 fiber，返回 null
	 *
	 * @param returnFiber 当前 wip fiber
	 * @param currentFiber 旧树上对应的子 fiber，mount 时来自 current.child（HostRoot 有值）/ null（其余为 null）
	 * @param newChild 新的子内容（ReactElement / 原始值 / 数组），来自父 fiber 的 beginWork 处理结果
	 */
	return function reconcileChildFibers(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild?: ReactElementType
	) {
		console.log(
			'reconcileChildFibers-returnFiber',
			returnFiber,
			'currentFiber',
			currentFiber,
			'newChild',
			newChild
		);
		// 判断Fragment,只拦截无key的，有key的还是会直接进入后续流程
		const isUnkeyedTopLevelFragment =
			typeof newChild === 'object' &&
			newChild !== null &&
			newChild.type === REACT_FRAGMENT_TYPE &&
			newChild.key === null;
		if (isUnkeyedTopLevelFragment) {
			// 这是单节点时的处理
			console.log('newChild 是 Fragment', newChild);
			newChild = newChild?.props.children;
		}

		if (typeof newChild === 'object' && newChild !== null) {
			// 先判断数组，再判断单一 ReactElement，避免数组误走 default 分支
			if (Array.isArray(newChild)) {
				return reconcileChildrenArray(returnFiber, currentFiber, newChild);
			}
			switch (newChild.$$typeof) {
				case REACT_ELEMENT_TYPE:
					return placeSingleChild(
						reconcileSingleElement(returnFiber, currentFiber, newChild)
					);
				default:
					if (__DEV__) {
						console.warn('未实现的reconcile类型 ', newChild);
					}
					break;
			}
		}
		// 我们暂时没处理多子节点的情况
		// TODO 多节点的情况 ul> li*3
		if (typeof newChild === 'string' || typeof newChild === 'number') {
			return placeSingleChild(
				reconcileSingleTextNode(returnFiber, currentFiber, newChild)
			);
		}

		// 现在只实现了,之前有，现在直接没了，旧的可不就是删掉了
		if (currentFiber !== null) {
			// 兜底删除为实现的类型
			deleteRemainingChildren(returnFiber, currentFiber);
		}

		if (__DEV__) {
			console.warn('未实现的reconcile类型 ', newChild);
		}
		return null;
	};
}

/**
 * 复用 fiber。调用 createWorkInProgress 基于旧 fiber 创建/复用 wip，
 * 同时重置 index 和 sibling（因为是单节点场景）。
 *
 * @param fiber 旧树上的 fiber（current）
 * @param pendingProps 新的 props（来自新的 ReactElement.props）
 */
function useFiber(fiber: FiberNode, pendingProps: Props): FiberNode {
	const clone = createWorkInProgress(fiber, pendingProps);
	clone.index = 0;
	clone.sibling = null;
	return clone;
}

/**
 * 获取 element 在 diff 中用于 Map 匹配的 key。
 *
 * 只有 ReactElement 有明确的 key 属性；其他类型（string / number / undefined / null / 数组）
 * 都没有 key，所以统一用 index 作为 Map 的键。
 *
 * 举例：
 *   newChild[i] = "text" → getElementKeyToUse("text", 0) → 返回 0（index）
 *   newChild[i] = {$$typeof, key: "abc"} → getElementKeyToUse(element, 0) → 返回 "abc"
 *
 * @param element 新子节点
 * @param index 在数组中的位置
 * @returns 用于 Map 匹配的 key
 */
function getElementKeyToUse(element: any, index?: number): Key {
	if (
		Array.isArray(element) ||
		typeof element === 'string' ||
		typeof element === 'number' ||
		element === undefined ||
		element === null
	) {
		return index;
	}
	return element.key !== null ? element.key : index;
}

/**
 * 在 reconcileChildrenArray 的循环中，为每个新 child 查找可复用的旧 fiber 或创建新 fiber。
 *
 * 调用时机：for 循环中每次处理 newChild[i] 时调用一次。
 *
 * 根据 element 类型分四种情况：
 *   - string/number → 创建或复用 HostText fiber
 *   - ReactElement（非 Fragment）→ type 相同复用，不同则新建
 *   - ReactElement（Fragment）→ 委托 updateFragment 处理
 *   - Array → 视为嵌套数组，包一层 Fragment fiber
 *
 * 举例（update 场景）：
 *   旧 fiber 树：li(k='1'), li(k='2'), li(k='3')
 *   新 children：[li(k='1', type='li'), <span>new</span>]
 *
 *   处理过程：
 *   i=0, li(k='1'): before = 旧 li#1, type 相同 → useFiber 复用
 *   i=1, <span>new</span>: before = 旧 li#2, type('span') !== type('li') → createFiberFromElement 新建
 *   后续 Map 中剩余 li#3 → 标记 ChildDeletion
 *
 * @param returnFiber 父 fiber
 * @param existingChildren 从 current sibling 构建的 Map（key/index → fiber）
 * @param index 新 children 中的索引
 * @param element 新的子节点（string / number / ReactElement / Array）
 * @returns 创建/复用后的 fiber，或 null（跳过该元素）
 */
function updateFromMap(
	returnFiber: FiberNode,
	existingChildren: ExistingChildren,
	index: number,
	element: any
): FiberNode | null {
	const keyToUse = getElementKeyToUse(element, index);
	// 取到了，代表存在之前的对应的节点，但是能不能复用还要看 before.type === element.type
	const before = existingChildren.get(keyToUse);

	// HostText
	if (typeof element === 'string' || typeof element === 'number') {
		if (before) {
			if (before.tag === HostText) {
				// 复用，同时删除existingChildren中的
				// 这一点不如vue3的高效
				existingChildren.delete(keyToUse);
				console.log('updateFromMap 复用 before:', before, 'element:', element);
				return useFiber(before, { content: element + '' });
			}
		}
		// 不能复用就新创建，但是我们这里不用把旧的删除，因为之后会统一删除map中还在的fiberNode节点,而且，还有可能根本就没有旧的
		return new FiberNode(HostText, { content: element + '' }, null);
	}

	// ReactElement
	if (typeof element === 'object' && element !== null) {
		switch (element.$$typeof) {
			case REACT_ELEMENT_TYPE:
				if (element.type === REACT_FRAGMENT_TYPE) {
					return updateFragment(
						returnFiber,
						before,
						element,
						keyToUse,
						existingChildren
					);
				}
				if (before) {
					if (before.type === element.type) {
						existingChildren.delete(keyToUse);
						console.log(
							'updateFromMap 复用 before:',
							before,
							'element.props:',
							element.props
						);
						return useFiber(before, element.props);
					}
				}
				// 不能复用就新创建，但是我们这里不用把旧的删除，因为之后会统一删除map中还在的fiberNode节点
				return createFiberFromElement(element);
		}
	}
	// 嵌套数组的情况，在React中所有嵌套数组都是这样处理的，{array} 在外部自动创建Fragment,把element当参数传进去
	// 然后会在下一轮，element数组会被当成children传过去，被reconcileChildrenArray处理，多么完美
	if (Array.isArray(element)) {
		// console.warn('还未实现数组类型的child');
		// 在 React 语义中，{} 里嵌入的数组表达式，最终渲染时就是直接展开、不产生 DOM 节点的——这就是 Fragment 的语义
		return updateFragment(
			returnFiber,
			before,
			element,
			keyToUse,
			existingChildren
		);
	}
	return null;
}

/**
 * 协调 Fragment 类型的子节点，创建 Fragment fiber 或复用旧的。
 *
 * 用于两处：
 *   1. updateFromMap 中 element.type === REACT_FRAGMENT_TYPE
 *   2. updateFromMap 中 element 是嵌套数组（在 React 语义中等效于 Fragment）
 *
 * 创建 Fragment fiber 时 pendingProps = elements 数组，
 * 后续 beginWork 的 case Fragment 会把它传给 reconcilerChildren。
 *
 * 举例：
 *   newChild[i] = [{type:'li',key:'1'}, {type:'li',key:'2'}]  // 嵌套数组
 *   current 无对应的 Fragment fiber → createFiberFromFragment
 *   → 创建 FiberNode(tag=Fragment, pendingProps=[li, li])
 *   后续 beginWork → reconcilerChildren → reconcileChildrenArray
 *
 * @param returnFiber 父 fiber
 * @param current 旧 fiber（可能为 undefined，表示没有对应的旧节点）
 * @param elements Fragment 的子节点数组，作为 pendingProps 传入
 * @param key 用于匹配的 key
 * @param existingChildren 从 current sibling 构建的 Map
 * @returns 创建/复用后的 Fragment fiber
 */
function updateFragment(
	returnFiber: FiberNode,
	current: FiberNode | undefined,
	elements: any[],
	key: Key,
	existingChildren: ExistingChildren
) {
	let fiber;
	if (!current || current.tag !== Fragment) {
		fiber = createFiberFromFragment(elements, key);
	} else {
		existingChildren.delete(key);
		fiber = useFiber(current, elements);
	}
	fiber.return = returnFiber;
	return fiber;
}

export const reconcileChildFibers = ChildReconciler(true);
// mount 时，不存在current，所以shouldTrackSideEffects 为false
// mount 时存在大量的插入，如果每个都进行标记，就会浪费性能，完全可以先离屏创建，之后再一次挂载,此次不进行标记
export const mountChildFibers = ChildReconciler(false);
