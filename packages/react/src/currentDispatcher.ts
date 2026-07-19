import { Action } from 'shared/ReactTypes';
import { HookDeps } from 'react-reconciler/src/fiberHooks';
/**
 * Hook 分发器接口。
 * renderWithHooks 根据 mount / update 切换不同的 Dispatcher 实例，
 * useState 等 hook 函数通过 resolveDispatcher 获取当前 Dispatcher 再调用。
 */
export interface Dispatcher {
	useState: <T>(initialState: (() => T) | T) => [T, Dispatch<T>];
	useEffect: (callback: () => void | void, deps: HookDeps | undefined) => void;
}

/**
 * setState 返回的 dispatch 函数签名字
 */
export type Dispatch<State> = (action: Action<State>) => void;

/**
 * 全局的 Dispatcher 引用。
 * mount 时指向 HookDispatcherOnMount，update 时指向 HookDispatcherOnUpdate。
 * 不在函数组件内调用 hook 时此值为 null → resolveDispatcher 抛错。
 */
const currentDispatcher: { current: Dispatcher | null } = {
	current: null
};

/**
 * 获取当前的 Hook Dispatcher。
 * 如果在函数组件外部调用 hook（currentDispatcher.current 为 null），抛出错误。
 */
export const resolveDispatcher = (): Dispatcher => {
	const dispatcher = currentDispatcher.current;
	if (dispatcher === null) {
		throw new Error('hook 只能在 函数组件中执行');
	}
	return dispatcher;
};

export default currentDispatcher;
