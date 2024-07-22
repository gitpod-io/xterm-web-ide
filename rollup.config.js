import merge from "deepmerge";
import commonjs from "@rollup/plugin-commonjs";
import { createBasicConfig } from "@open-wc/building-rollup";
import typescript from "@rollup/plugin-typescript";
import nodePolyfills from "rollup-plugin-polyfill-node";

const baseConfig = createBasicConfig();

export default merge(baseConfig, {
    input: "./src/client.ts",
    treeshake: true,
    output: {
        file: "dist/bundle.js",
        format: "iife",
        dir: undefined,
        sourcemap: "inline",
        globals: {
            fs: "require$$0",
            path: "require$$1",
            util: "require$$2",
            stream: "require$$3",
            net: "require$$0$2",
            url: "require$$0$3",
            crypto: "require$$0$1",
            os: "require$$1",
        },
    },
    plugins: [
        nodePolyfills({
            include: ["stream", "util", "url", "path", "net", "fs", "os", "crypto"],
            sourceMap: true,
        }),
        commonjs(),
        typescript({
            tsconfig: "./tsconfig.json",
        }),
    ],
});
