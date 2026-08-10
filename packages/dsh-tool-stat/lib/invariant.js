/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-stat`.
 * @module @deepseek-ai/dsh-tool-stat/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-tool-stat';
/** Cordis companion plugin name. */
export const name = 'stat-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** No runtime invariant: behavior is covered by package tests and the tool registry. */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
