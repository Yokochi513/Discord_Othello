/**
 * Activity のエントリポイント。
 * ルート要素へ React アプリを描画する。
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
    throw new Error("ルート要素 #root が見つかりません");
}

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
