# 学习记录 0001: Symbol 在 React 内部类型系统中的应用

## 决策

在 `ReactSymbols.ts` 中使用 `Symbol.for()` + 魔数 fallback 模式定义 React 内部类型常量。

## 关键洞察

### 1. `Symbol.for()` 的跨模块唯一性是 React 选择它的核心原因

React 在 monorepo 中分多个包（react、react-dom、react-reconciler），每个包**独立构建**。如果用 `Symbol()` 而不是 `Symbol.for()`，每个包构建时创建的 Symbol 将是不同的实例：

```
// react 包构建 → Symbol('react.element') → #[private_id=123]
// react-dom 包构建 → Symbol('react.element') → #[private_id=456]
// 123 !== 456 → 类型判断全面失效！
```

`Symbol.for()` 通过全局注册表解决了这个问题 —— 同一个 key 在整个 JavaScript 运行时中只对应一个 Symbol 值。

### 2. 安全性优势比唯一性更强

很多初学者认为 Symbol 的主要优势是唯一性，但在 React 的场景中，**不可被 JSON 构造** 才是更重要的优势：

```javascript
// 攻击者通过 JSON 注入
const maliciousData = JSON.parse('{"$$typeof": "react.element"}');
// 这只会产生字符串 "react.element"

// 而真正的 React element 的 $$typeof 是 Symbol
// Symbol 值永远无法从 JSON.parse 产生
```

### 3. 魔数 fallback 的选择有规律

0xeac7 不是随机数，而是 "element" 的十六进制谐音。这说明 React 团队在设计 fallback 时也考虑了可读写性。

### 4. 能力检测是前置条件

```javascript
const supportSymbol = typeof Symbol === 'function' && Symbol.for;
```

这比 `typeof Symbol !== 'undefined'` 更严格 —— 既检查 Symbol 构造函数存在，又检查 `.for` 方法存在。

## 影响范围

- 所有需要判断 element 类型的地方（beginWork.ts、reconcileChildren 等）
- 新增内部类型时必须遵循此模式
- 魔数列表必须维护，新增时不能冲突

## 关联文件

- `packages/shared/ReactSymbols.ts` (源文件)
- `packages/shared/ReactSymbols.md` (本解读文档)
- `packages/react/src/jsx.ts` (使用 REACT_ELEMENT_TYPE)
- `packages/react-reconciler/src/beginWork.ts` (消费这些类型)
