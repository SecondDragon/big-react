/** ReactElement.type 的实际类型，比如 'div', App函数, Fragment等 */
export type Type = any;
/** 用于 diff 算法的唯一标识 */
export type Key = any;
/** ref 可以是回调函数或 {current} 对象 */
export type Ref = { current: any } | ((instance: any) => void) | null;
/** fiber 的 pendingProps / memoizedProps */
export type Props = any;
/** jsxDEV 第一个参数的联合类型 */
export type ElementType = any;

/**
 * ReactElement 是 JSX 编译后的产物，是一个轻量的 JS 对象。
 * 它是 fiber 的「原材料」——每次更新时用新的 ReactElement 和旧 fiber 做对比。
 */
export interface ReactElementType {
	$$typeof: symbol | number;
	type: ElementType;
	key: Key;
	props: Props;
	ref: Ref;
	__mark: string;
}

/**
 * setState 可接收的参数类型：新值 或 (旧值→新值) 的函数
 */
export type Action<State> = State | ((prevState: State) => State);

export type ReactContext<T> = {
	$$typeof: symbol | number;
	Provider: ReactProviderType<T> | null;
	_currentValue: T;
};

export type ReactProviderType<T> = {
	$$typeof: symbol | number;
	_context: ReactContext<T> | null;
};

export type Usable<T> = Thenable<T> | ReactContext<T>;

export interface Wakeable<Result = any> {
	then(
		onFulfill: () => Result,
		onReject: () => Result
	): void | Wakeable<Result>;
}

interface ThenableImpl<T, Result, Err> {
	then(
		onFulfill: (value: T) => Result,
		onReject: (error: Err) => Result
	): void | Wakeable<Result>;
}

interface UntrackedThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status?: void;
}

export interface PendingThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status: 'pending';
}

export interface FulfilledThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status: 'fulfilled';
	value: T;
}

export interface RejectedThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status: 'rejected';
	reason: Err;
}

export type Thenable<T, Result = void, Err = any> =
	| UntrackedThenable<T, Result, Err>
	| PendingThenable<T, Result, Err>
	| FulfilledThenable<T, Result, Err>
	| RejectedThenable<T, Result, Err>;
