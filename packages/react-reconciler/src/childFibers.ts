import { createFiberFromElement, FiberNode } from './fiber';
import { ReactElementType } from 'shared/ReactTypes';
import { REACT_ELEMENT_TYPE } from 'shared/ReactSymbols';
import { HostText } from './workTags';
import { Placement } from './fiberFlags';

/**
 * 如果是mountChildFibers，就不必每个fiberNode都标识副作用，
 * 而是直接构建离屏的dom树，之后commit时只要把父 使用 placement 等操作放进dom就可以
 * @param shouldTrackSideEffects
 * @constructor
 */
function ChildReconciler(shouldTrackSideEffects: boolean) {
	function reconcileSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		element: ReactElementType
	) {
		const fiber = createFiberFromElement(element);
		fiber.return = returnFiber;
		return fiber;
	}
	function reconcileSingleTextNode(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		content: string | number
	) {
		const fiber = new FiberNode(HostText, { content }, null);
		fiber.return = returnFiber;
		return fiber;
	}
	function placeSingleChild(fiber: FiberNode) {
		// 这里的意思是只有被标记为允许标记且不是首屏渲染时才允许标记
		// 首屏渲染时，直接挂载即可，别忘了还有根，针对mount，有根部保证会挂载
		if (shouldTrackSideEffects && fiber.alternate === null) {
			// 挂载时，直接挂载即可
			fiber.flags |= Placement;
		}
		return fiber;
	}

	return function reconcilerChildFibers(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild?: ReactElementType
	) {
		if (typeof newChild === 'object' && newChild !== null) {
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
		if (__DEV__) {
			console.warn('未实现的reconcile类型 ', newChild);
		}
		return null;
	};
}

export const reconcilerChildFibers = ChildReconciler(true);
// mount 时，不存在current，所以shouldTrackSideEffects 为false
// mount 时存在大量的插入，如果每个都进行标记，就会浪费性能，完全可以先离屏创建，之后再一次挂载,此次不进行标记
export const mountChildFibers = ChildReconciler(false);
