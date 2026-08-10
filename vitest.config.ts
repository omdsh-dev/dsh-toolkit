import { defineConfig } from 'vitest/config'

/**
 * Toolkit 独立测试配置：子包 cwd 下运行 vitest 时，向上查找会先命中本文件，
 * 阻断对 monorepo 根全局 include 模式的继承（根模式不含 toolkit 子包路径）。
 */
export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
  },
})
