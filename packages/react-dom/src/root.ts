// ReactD0M.createRoot(root).render(<App/>)
import { ReactElementType } from 'shared/ReactTypes';
import { Container } from 'hostConfig';
import {
	createContainer,
	updateContainer
} from 'react-reconciler/src/fiberReconciler';
import { initEvent } from './SyntheticEvent';

/**
 * ReactDOM.createRoot 的实现。
 * 1. 调用 createContainer(container) 创建 FiberRootNode + HostRoot fiber
 * 2. 返回 { render } 方法，render(element) 内部调用 updateContainer(element, root)
 *
 * @param container 真实的 DOM 容器（如 document.querySelector('#root')）
 */
export function createRoot(container: Container) {
	const root = createContainer(container);

	return {
		render(element: ReactElementType) {
			initEvent(container, 'click');
			return updateContainer(element, root);
		}
	};
}
