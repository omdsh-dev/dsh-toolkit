import { defineConfig } from 'vitest/config'

/**
 * Toolkit 独立测试配置：子包 cwd 下运行 vitest 时，向上查找会先命中本文件，
 * 显式覆盖 monorepo 配置，并同时纳入根 tests 与 vendored 子包 tests。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'packages/*/tests/**/*.spec.ts'],
  },
})
