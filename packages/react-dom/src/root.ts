// ReactD0M.createRoot(root).render(<App/>)
import { ReactElementType } from 'shared/ReactTypes';
import { Container } from './hostConfig';
import {
	createContainer,
	updateContainer
} from 'react-reconciler/src/fiberReconciler';

export function createRoot(container: Container) {
	const root = createContainer(container);

	return {
		render(element: ReactElementType) {
			updateContainer(element, root);
		}
	};
}
