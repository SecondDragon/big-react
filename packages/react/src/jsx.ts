import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';
import {
	Key,
	Ref,
	Props,
	ReactElementType,
	ElementType
} from 'shared/ReactTypes';

// ReactElement

/**
 * 创建 ReactElement 对象。
 * type: 'div' | App函数 | Fragment 等，决定了后续创建 fiber 时的 WorkTag
 * key: diff 的线索，来自 jsxDEV 的 maybeKey 或 config.key
 * ref: 来自 config.ref
 * props: 其余属性，children 也在此列
 */
const ReactElement = function (
	type: ElementType,
	key: Key,
	ref: Ref,
	props: Props
): ReactElementType {
	const element = {
		$$typeof: REACT_ELEMENT_TYPE,
		type,
		key,
		ref,
		props,
		__mark: 'stl'
	};
	return element;
};

/**
 * 判断一个对象是否为合法的 ReactElement
 */
export function isValidElement(object: any) {
	return (
		typeof object === 'object' &&
		object !== null &&
		object.$$typeof === REACT_ELEMENT_TYPE
	);
}

/**
 * 经典 JSX 运行时（React.createElement）。
 * children 通过剩余参数传入，自动填入 props.children。
 */
export const jsx = (type: ElementType, config: any, ...maybeChildren: any) => {
	let key: Key = null;
	const props: Props = {};
	let ref: Ref = null;

	for (const prop in config) {
		const val = config[prop];
		if (prop === 'key') {
			if (val !== undefined) {
				key = '' + val;
			}
			continue;
		}
		if (prop === 'ref') {
			if (val !== undefined) {
				ref = val;
			}
			continue;
		}
		if ({}.hasOwnProperty.call(config, prop)) {
			props[prop] = val;
		}
	}
	const maybeChildrenLength = maybeChildren.length;
	if (maybeChildrenLength) {
		if (maybeChildrenLength === 1) {
			props.children = maybeChildren[0];
		} else {
			props.children = maybeChildren;
		}
	}
	return ReactElement(type, key, ref, props);
};

export const Fragment = REACT_FRAGMENT_TYPE;

/**
 * 新版自动 JSX 运行时（React 17+ / TypeScript jsx: "react-jsxdev"）。
 * config 来自属性展开；maybeKey 来自 Babel/TS 编译时从源码位置自动推导。
 * children 是作为 config.children 传入的，而非剩余参数——这是与经典 jsx 的关键区别。
 */
export const jsxDEV = (type: ElementType, config: any, maybeKey: any) => {
	let key: Key = null;
	const props: Props = {};
	let ref: Ref = null;

	if (maybeKey !== undefined) {
		key = '' + maybeKey;
	}

	for (const prop in config) {
		const val = config[prop];
		if (prop === 'key') {
			if (val !== undefined) {
				key = '' + val;
			}
			continue;
		}
		if (prop === 'ref') {
			if (val !== undefined) {
				ref = val;
			}
			continue;
		}
		// 判断是config自己的，还是原型上的，只要是自己的都放上去
		if ({}.hasOwnProperty.call(config, prop)) {
			props[prop] = val;
		}
	}

	return ReactElement(type, key, ref, props);
};
