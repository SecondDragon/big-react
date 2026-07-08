# RESOURCES.md — JavaScript Symbol 学习资源

## 首要资源（核心知识来源）

| 资源 | 类型 | 说明 | 链接 |
|------|------|------|------|
| MDN: Symbol | 文档 | 最权威的 Symbol API 参考 | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol |
| TC39 规范 - Symbol 类型 | 规范 | ECMAScript 语言规范的原始定义 | https://tc39.es/ecma262/#sec-symbol-type |
| JavaScript.info: Symbol | 教程 | 清晰易懂的 Symbol 教程 | https://javascript.info/symbol |

## 深入阅读

| 资源 | 类型 | 说明 | 链接 |
|------|------|------|------|
| React 源码：共享内部类型 | 源码 | React 官方仓库中的 ReactSymbols.js | https://github.com/facebook/react/blob/main/packages/shared/ReactSymbols.js |
| You Don't Know JS Yet: Symbols | 书籍 | Kyle Simpson 深入讲解 Symbol | https://github.com/getify/You-Dont-Know-JS/blob/2nd-ed/objects-classes/ch9.md |
| V8 引擎对 Symbol 的实现 | 博客 | Symbol 在 V8 中的底层表示 | https://v8.dev/blog/symbols |

## 相关社区

- React 中文论坛 (zhihu/cnode) — 交流 React 源码理解
- TC39 Discourse — 参与 JavaScript 语言设计讨论

## 学习路径建议

1. **第 1 步**：MDN 文档通读 Symbol API → 完成基础概念理解
2. **第 2 步**：阅读 `ReactSymbols.ts` → 对照本项目理解实际应用
3. **第 3 步**：阅读 React 官方仓库中的 `ReactSymbols.js` → 对比差异
4. **第 4 步**：阅读 V8 博客 → 理解底层实现
