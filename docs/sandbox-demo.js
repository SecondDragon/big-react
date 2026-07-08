/**
 * sandbox-demo.js
 * 
 * 模拟 qiankun 沙箱 + UMD/非UMD 代码执行对比。
 * 直接在 Node.js 中运行： node sandbox-demo.js
 */

// ===== 模拟 qiankun 沙箱 =====
class MicroSandbox {
  constructor() {
    this.cache = new Map();
    this.proxyWindow = new Proxy(globalThis, {
      get: (target, key) => {
        if (this.cache.has(key)) return this.cache.get(key);
        return target[key];
      },
      set: (target, key, value) => {
        this.cache.set(key, value);
        console.log(`  [沙箱捕获] ${String(key)} =`,
          typeof value === 'function' ? (value.name || 'fn') : 
          typeof value === 'object' ? JSON.stringify(Object.keys(value)) : value);
        return true;
      }
    });
  }

  exec(code) {
    this.cache.clear();
    const fn = new Function('window', code);
    fn(this.proxyWindow);
    const hasExport = this.cache.has('ReactApp');
    console.log('  --- 沙箱捕获结果 ---');
    console.log(`  ${hasExport ? '✅ 捕获到 ReactApp' : '❌ 未捕获到任何导出'}`);
    if (hasExport) {
      const app = this.cache.get('ReactApp');
      console.log(`  导出的方法: ${Object.keys(app).join(', ')}`);
    }
    return this.cache;
  }
}

// ===== 实验A：非 UMD 代码（模拟 webpack 默认 IIFE） =====
const nonUmdCode = `
(function(modules) {
  function __webpack_require__(id) {
    return modules[id](__webpack_require__);
  }
  __webpack_require__("./src/index.js");
})({
  "./src/index.js": function(__webpack_require__) {
    const App = {
      bootstrap() { return 'bootstrap'; },
      mount()     { return 'mount'; },
      unmount()   { return 'unmount'; }
    };
    // ★ 这个 App 永远只在闭包内部，无人能触及
    // ★ 没有 return，没有赋值给 window，没有任何出口
  },
  "./src/utils.js": function(__webpack_require__) {
    // 另一个模块，同样在闭包内
  }
});
`;

// ===== 实验B：UMD 风格的代码 =====
const umdCode = `
(function(root, factory) {
  root.ReactApp = factory();
})(window, function() {
  const App = {
    bootstrap() { return 'bootstrap'; },
    mount()     { return 'mount'; },
    unmount()   { return 'unmount'; }
  };
  return App;  // ★ 通过 return 把 App 传出来
});
`;

// ===== 实验C：在非UMD代码中直接设 window.xxx =====
// 这实际上是一种"手动UMD"方式
const manualWindowCode = `
(function(modules) {
  function __webpack_require__(id) {
    return modules[id](__webpack_require__);
  }
  window.ReactApp = __webpack_require__("./src/index.js");
})({
  "./src/index.js": function(__webpack_require__) {
    return {
      bootstrap() { return 'bootstrap'; },
      mount()     { return 'mount'; },
      unmount()   { return 'unmount'; }
    };
  }
});
`;

// ===== 运行实验 =====
const sandbox = new MicroSandbox();

console.log('='.repeat(50));
console.log('实验A：非 UMD 产物（标准 webpack IIFE）');
console.log('='.repeat(50));
sandbox.exec(nonUmdCode);

console.log('\n');
console.log('='.repeat(50));
console.log('实验B：UMD 产物');
console.log('='.repeat(50));
sandbox.exec(umdCode);

console.log('\n');
console.log('='.repeat(50));
console.log('实验C：非UMD但手动 window.ReactApp = ...');
console.log('='.repeat(50));
sandbox.exec(manualWindowCode);

console.log('\n');
console.log('='.repeat(50));
console.log('结论');
console.log('='.repeat(50));
console.log(`
  A (非UMD)  → ❌ 沙箱捕获不到任何导出
  B (UMD)    → ✅ 沙箱捕获到 ReactApp，包含 bootstrap, mount, unmount
  C (手动)   → ✅ 也能捕获到，但需要子应用代码主动感知 window

  ★ 核心机制：
  非UMD webpack 产物的导出被闭包"困死"，外部无法穿透。
  UMD 通过 root.xxx = factory() 这条路径，把导出暴露给了作为 root 传入的代理 window，
  从而被 Proxy 的 set 拦截捕获。
  ★ UMD 是标准化契约，不是唯一方式，但是最可靠、最通用的方式。
`);
