# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

This is **Big-React**, a from-scratch implementation of React 18 used for learning how React works internally. It is organized as a pnpm monorepo under `packages/`.

## Common commands

- **Install dependencies**: `pnpm install`
- **Build development bundles**: `pnpm run build:dev`
  - Outputs UMD bundles to `dist/node_modules/` for `react`, `react-dom`, and `react/jsx-dev-runtime`.
  - The root `package.json` depends on `react` and `react-dom` `^0.0.0` so the built packages in `dist/node_modules` can be linked for local testing.
- **Lint and auto-fix**: `pnpm run lint`
  - Runs ESLint with Prettier on `packages/**/*.{js,ts,jsx,tsx}`.
- **Type-check**: `npx tsc --noEmit`
  - `tsconfig.json` already sets `noEmit: true`; this checks the whole `packages` tree.

There is no test runner configured yet (Jest is on the TODO list).

## Monorepo structure

The workspace is defined in `pnpm-workspace.yaml`:

- `packages/react` — public React API and JSX transform (`jsxDEV`).
- `packages/react-dom` — DOM renderer; wires the reconciler to browser DOM via `hostConfig`.
- `packages/react-reconciler` — core Fiber reconciler. It is renderer-agnostic and imports host operations through `hostConfig.ts`.
- `packages/shared` — shared symbols (`REACT_ELEMENT_TYPE`) and TypeScript types.

Cross-package imports use `workspace:*` dependencies and import by package name, e.g. `import { ReactElement } from 'shared/ReactTypes'`.

## High-level architecture

### Renderer-agnostic reconciler

`react-reconciler` does not talk to the DOM directly. Instead, `packages/react-dom/src/hostConfig.ts` defines the host environment operations (`createInstance`, `appendInitialChild`, etc.), and `packages/react-reconciler/src/hostConfig.ts` re-exports them. To add another renderer (e.g. ReactNoop), provide a different host config and keep the reconciler unchanged.

### Fiber tree and work loop

- `FiberNode` (`react-reconciler/src/fiber.ts`) is the unit of work. It stores props, state, effects (`flags`/`subtreeFlags`), and tree pointers (`return`, `sibling`, `child`).
- `FiberRootNode` wraps the host container and points to the current tree via `current`.
- `createWorkInProgress` creates the alternate Fiber for the next render, linking `current.alternate` and `wip.alternate`.

The render phase is synchronous and split into two passes:

1. **beginWork** (`react-reconciler/src/beginWork.ts`) — walks down the tree, processes updates, and creates/reconciles child fibers.
2. **completeWork** (`react-reconciler/src/completeWork.ts`) — walks back up, creates host DOM nodes, appends children, and bubbles `subtreeFlags`.

`workLoop.ts` orchestrates the passes via `performUnitOfWork` and `completeUnitOfWork`. The commit phase is not yet implemented.

### Update queue

`updateQueue.ts` manages pending updates on a Fiber. `createContainer` initializes the queue; `updateContainer` creates an update, enqueues it, and calls `scheduleUpdateOnFiber`, which currently triggers `performSyncWorkOnRoot` immediately.

### JSX / React elements

`packages/react/src/jsx.ts` implements the automatic JSX runtime (`jsxDEV`). Elements are plain objects marked with `REACT_ELEMENT_TYPE` (`shared/ReactSymbols.ts`) and a `__mark: 'KaSong'` field.

## Code style

- Prettier config: tabs, single quotes, no trailing commas, 80-char print width.
- ESLint extends `@typescript-eslint/recommended` and Prettier; `no-case-declarations` and `no-constant-condition` are disabled.
- Commit messages follow Conventional Commits via commitlint and Husky hooks.
