export type WorkTag =
	| typeof FunctionComponent
	| typeof HostRoot
	| typeof HostComponent
	| typeof HostText
	| typeof Fragment
	| typeof ContextProvider
	| typeof SuspenseComponent
	| typeof OffscreenComponent
	| typeof LazyComponent
	| typeof MemoComponent;
// 函数节点
export const FunctionComponent = 0;
/**
 * HostRoot 节点项目挂载的根fiber节点，他不对应代码中的任何组件或者dom节点，只是一个根，是为了便于任何一级node都能找到一个唯一的根以便更新
 * 他的stateNode指向FiberRootNode节点
 * FiberRootNode的current指向HostRoot这个节点
 */
export const HostRoot = 3;
// 代表普通的html标签
export const HostComponent = 5;
// 文本节点
export const HostText = 6;
export const Fragment = 7;
export const ContextProvider = 8;

export const SuspenseComponent = 13;
export const OffscreenComponent = 14;

export const LazyComponent = 16;
export const MemoComponent = 15;
