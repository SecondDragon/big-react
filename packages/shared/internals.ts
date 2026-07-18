import * as React from 'react';

/**
 * 从 react 包中取出内部共享层，暴露给 react-reconciler。
 * 核心用途：让 renderWithHooks 可以切换 currentDispatcher，
 * 从而让 useState 等 hook 在 mount / update 时调用不同的实现。
 */
const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

export default internals;
