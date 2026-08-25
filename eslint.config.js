import tseslint from "typescript-eslint";

export default [
    ...tseslint.configs.recommended,
    {
        files: ["packages/core/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["node:*"],
                            message: "core は Node 固有 API に依存しない (要件定義 §5.3) ",
                        },
                        {
                            group: ["discord*", "@discordjs/*", "@discord/*", "ws", "socket.io*"],
                            message: "core は Discord / WebSocket に依存しない (要件定義 §5.3) ",
                        },
                    ],
                    paths: [
                        "fs",
                        "path",
                        "os",
                        "crypto",
                        "http",
                        "https",
                        "net",
                        "child_process",
                        "worker_threads",
                        "stream",
                        "url",
                        "process",
                        "buffer",
                    ],
                },
            ],
        },
    },
];
