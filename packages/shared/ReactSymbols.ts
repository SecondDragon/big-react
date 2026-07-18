/**
 * React 内部类型标识符。使用了 Symbol.for 保证了跨 iframe / worker 等
 * 多 Realm 场景下的同构性。不支持 Symbol 的环境回退到十六进制常量。
 */
const supportSymbol = typeof Symbol === 'function' && Symbol.for;

export const REACT_ELEMENT_TYPE = supportSymbol
	? Symbol.for('react.element')
	: 0xeac7;

export const REACT_FRAGMENT_TYPE = supportSymbol
	? Symbol.for('react.fragment')
	: 0xeaca;

export const REACT_CONTEXT_TYPE = supportSymbol
	? Symbol.for('react.context')
	: 0xeacc;

export const REACT_PROVIDER_TYPE = supportSymbol
	? Symbol.for('react.provider')
	: 0xeac2;

export const REACT_SUSPENSE_TYPE = supportSymbol
	? Symbol.for('react.suspense')
	: 0xead1;

export const REACT_LAZY_TYPE = supportSymbol
	? Symbol.for('react.lazy')
	: 0xead4;

export const REACT_MEMO_TYPE = supportSymbol
	? Symbol.for('react.memo')
	: 0xead3;
