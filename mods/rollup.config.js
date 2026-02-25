import { string } from 'rollup-plugin-string';
import terser from '@rollup/plugin-terser';
import getBabelOutputPlugin from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
    input: "userScript.js",
    output: { file: "../dist/userScript.js", format: "iife" },
    plugins: [
        string({
            include: "**/*.css",
        }),
        nodeResolve({
            browser: true,
            preferBuiltins: false,
        }),
        json(),
        commonjs({
            include: [/node_modules/, /mods/],
            transformMixedEsModules: true,
        }),
        getBabelOutputPlugin({
            babelHelpers: 'bundled',
            presets: [
                ['@babel/preset-env', {
                    // Keep broad compatibility for older Tizen WebViews that can still receive
                    // current CDN bundles but fail on newer syntax.
                    targets: {
                        chrome: '47'
                    },
                    // Keep polyfills for safety
                    useBuiltIns: false,
                    // Don't transform modules (Rollup handles that)
                    modules: false
                }],
            ],
        }),
        terser({
            ecma: 5,
            mangle: true,
            // Keep WebSocket and other important globals
            compress: {
                pure_getters: true,
                unsafe: false,
                unsafe_comps: false,
                warnings: false
            }
        }),
    ]
};