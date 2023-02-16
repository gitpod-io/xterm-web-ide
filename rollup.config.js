import merge from 'deepmerge';
import commonjs from '@rollup/plugin-commonjs';
import polyfillNode from 'rollup-plugin-polyfill-node';
import { createBasicConfig } from '@open-wc/building-rollup';
import typescript from '@rollup/plugin-typescript';

const baseConfig = createBasicConfig();

export default merge(baseConfig, {
    input: './src/client.ts',
    treeshake: true,
    output: {
        file: 'dist/bundle.js',
        format: 'iife',
        dir: undefined,
        sourcemap: 'inline',
        globals: {
          fs: 'require$$0',
          path: 'require$$1',
          util: 'require$$2',
          stream: 'require$$3'
        }
      },
      plugins: [
        polyfillNode({
          module: 'empty',
          modules: {
            stream: 'stream-browserify'
          }
        }),
        commonjs(),
        typescript({
          tsconfig: './tsconfig.json'
        })
      ]
});