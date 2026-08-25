import jsdoc from "eslint-plugin-jsdoc";
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
    // JSDoc は公開 API の仕様書として扱う。
    // 実装ファイルの export のみを対象とし、テストとテスト用ヘルパーは対象外とする。
    {
        files: ["packages/**/src/**/*.ts"],
        ignores: ["packages/**/src/**/*.test.ts"],
        plugins: { jsdoc },
        // 型はシグネチャが持つため、JSDoc 側には型を書かせない
        settings: { jsdoc: { mode: "typescript" } },
        rules: {
            // export されたものには JSDoc を必須とする
            "jsdoc/require-jsdoc": [
                "error",
                {
                    publicOnly: true,
                    require: {
                        FunctionDeclaration: true,
                        // const に代入された関数は VariableDeclaration 側で拾うため、
                        // 二重に報告されないよう関数式そのものは対象外とする
                        FunctionExpression: false,
                        ArrowFunctionExpression: false,
                        ClassDeclaration: true,
                        MethodDefinition: true,
                    },
                    contexts: [
                        "TSTypeAliasDeclaration",
                        "TSInterfaceDeclaration",
                        "TSEnumDeclaration",
                        "VariableDeclaration",
                    ],
                },
            ],
            "jsdoc/require-description": "error",

            // 引数と戻り値は必ず書き、説明を空にしない
            "jsdoc/require-param": "error",
            "jsdoc/require-param-name": "error",
            "jsdoc/require-param-description": "error",
            "jsdoc/require-returns": "error",
            "jsdoc/require-returns-check": "error",
            "jsdoc/require-returns-description": "error",

            // 型注釈と重複するため、JSDoc に型は書かない
            "jsdoc/no-types": "error",
            "jsdoc/require-param-type": "off",
            "jsdoc/require-returns-type": "off",

            // 書式の検証
            "jsdoc/check-alignment": "error",
            "jsdoc/check-param-names": "error",
            "jsdoc/check-tag-names": "error",
            "jsdoc/empty-tags": "error",
            "jsdoc/no-multi-asterisks": "error",
            "jsdoc/valid-types": "error",
        },
    },
];
