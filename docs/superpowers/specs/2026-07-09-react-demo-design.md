# react-demo：自建 React 调试项目

## 目标

在 `demos/react-demo` 下创建一个标准 Vite + React (JS) 项目，通过 Vite `resolve.alias` 将 `react` 和 `react-dom` 直接指向 `dist/node_modules/` 下的构建产物，用于调试和验证 React 源码修改的效果。

## 架构

```
big-react (pnpm workspace 根)
  ├─ packages/react        ──rollup build──→  dist/node_modules/react
  ├─ packages/react-dom    ──rollup build──→  dist/node_modules/react-dom
  └─ demos/react-demo      ──resolve.alias──→  dist/node_modules/react
                                                dist/node_modules/react-dom
```

- `demos/react-demo` 不在 `pnpm-workspace.yaml` 中，完全独立
- `react` 和 `react-dom` 从 `package.json` 的 `dependencies` 中移除
- 通过 Vite 的 `resolve.alias` 将 `react` / `react-dom` 直接映射到 `dist/node_modules/`
- 删除方式：`rm -rf demos/react-demo`，零遗留

## 使用流程

```bash
# 1. 构建自建 React
pnpm run build:dev

# 2. 进入 Demo 并启动
cd demos/react-demo
pnpm run dev

# 3. 修改 React 源码后
pnpm run build:dev    # 重新构建
# 浏览器刷新即可看到效果，无需重启 Vite 或清除缓存
```
