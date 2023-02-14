import merge from 'deepmerge';
import commonjs from '@rollup/plugin-commonjs';
import polyfillNode from 'rollup-plugin-polyfill-node';
import { createBasicConfig } from '@open-wc/building-rollup';

const baseConfig = createBasicConfig();

export default merge(baseConfig, {
    input: './out-tsc/src/client.js',
    treeshake: true,
    output: {
        file: 'dist/bundle.js',
        format: 'iife',
        dir: undefined,
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
        commonjs()
      ]
});