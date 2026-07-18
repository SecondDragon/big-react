# RESOURCES.md — 学习资源总清单

## 一、JavaScript Symbol

| 资源 | 类型 | 说明 | 链接 |
|------|------|------|------|
| MDN: Symbol | 文档 | 最权威的 Symbol API 参考 | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol |
| TC39 规范 - Symbol 类型 | 规范 | ECMAScript 语言规范的原始定义 | https://tc39.es/ecma262/#sec-symbol-type |
| JavaScript.info: Symbol | 教程 | 清晰易懂的 Symbol 教程 | https://javascript.info/symbol |
| React 源码：共享内部类型 | 源码 | React 官方仓库中的 ReactSymbols.js | https://github.com/facebook/react/blob/main/packages/shared/ReactSymbols.js |

## 二、浏览器事件模型 & React 合成事件

| 资源 | 类型 | 说明 | 链接 |
|------|------|------|------|
| MDN: addEventListener | 文档 | **最佳一手资料**，事件 API 完整参考 | https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener |
| DOM 规范：事件介绍 | 规范 | WHATWG DOM 标准事件章节 | https://dom.spec.whatwg.org/#introduction-to-dom-events |
| MDN: Event | 文档 | Event 对象所有属性/方法 | https://developer.mozilla.org/en-US/docs/Web/API/Event |
| MDN: 事件冒泡与捕获 | 教程 | 图文并茂的事件流教程 | https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling |
| React 源码：SyntheticEvent | 源码 | React 官方合成事件实现 | https://github.com/facebook/react/blob/main/packages/react-dom/src/events/SyntheticEvent.js |
| JavaScript.info: 冒泡与捕获 | 教程 | 图解清晰的事件流教程 | https://javascript.info/bubbling-and-capturing |
| JavaScript.info: 事件委托 | 教程 | 深入讲解事件委托模式 | https://javascript.info/event-delegation |

## 三、学习路径建议

1. **事件系统**：先读 MDN addEventListener → 再看 JavaScript.info 冒泡与捕获 → 动手在控制台跑代码 → 最后对照本项目的 SyntheticEvent.ts
2. **合成事件**：先理解原生事件委托 → 再读本项目的 SyntheticEvent.ts → 对照 React 官方源码理解差异
