import { isValidElement as isValidElementFn, jsxDEV } from './src/jsx';
import currentDispatcher, {
	Dispatcher,
	resolveDispatcher
} from './src/currentDispatcher';

export { Fragment } from './src/jsx';

/**
 * useState hook 的对外暴露。
 * 运行时通过 resolveDispatcher 获取 mount 或 update 的 Dispatcher 再转发。
 * @param initialState 初始值或惰性初始化函数
 */
export const useState: Dispatcher['useState'] = (initialState) => {
	const dispatcher = resolveDispatcher();

	return dispatcher.useState(initialState);
};

/**
 * 内部数据共享层。将 currentDispatcher 暴露给 react-reconciler，
 * 使得 renderWithHooks 可以在执行组件函数前切换 Dispatcher。
 */
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
	currentDispatcher
};

export const version = '0.0.0';
// TODO:根据环境区分使用jsx/jsXDEV
export const createElement = jsxDEV;

export const isValidElement = isValidElementFn;
