import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        globals: false,
        // DOM に依存しない純粋ロジックのみをテスト対象とする（要件定義 §17）
        include: ["src/**/*.test.ts"],
    },
});
