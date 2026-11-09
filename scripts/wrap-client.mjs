import { readFileSync, writeFileSync, rmSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const body = readFileSync('.client-build/client.cjs', 'utf8').replace(/^"use strict";?\s*/, '')
const out = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
});
`
writeFileSync('lib/client.js', out)
rmSync('.client-build', { recursive: true, force: true })
console.log('wrote lib/client.js', out.length, 'bytes')
