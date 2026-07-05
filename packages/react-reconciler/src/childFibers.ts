import { createFiberFromElement, FiberNode } from './fiber';
import { ReactElementType } from 'shared/ReactTypes';
import { REACT_ELEMENT_TYPE } from 'shared/ReactSymbols';
import { HostText } from './workTags';
import { Placement } from './fiberFlags';

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
		// 首屏渲染时，直接挂载即可
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
					return reconcileSingleElement(returnFiber, currentFiber, newChild);
				default:
					if (__DEV__) {
						console.warn('未实现的reconcile类型 ', newChild);
					}
					break;
			}
		}
		if (typeof newChild === 'string' || typeof newChild === 'number') {
			return reconcileSingleTextNode(returnFiber, currentFiber, newChild);
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
