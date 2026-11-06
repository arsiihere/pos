// 03a §10.6, P-12: the simulator, exported as @pos/engine/sim for test files only (lint.test.ts asserts no src file
// imports it).
export { generateDay, TICK_MS, type GenerateOptions, type SimDay, type SimLine, type SimOrder, type SimStation } from './generate';
export { policyReport, type PolicyReport } from './report';
export { runDay, twoDayLog, type Policy, type RunOptions, type SimResult } from './run';
