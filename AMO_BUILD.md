# Firefox reviewer build instructions

Expired Domains is written in TypeScript and bundled by WXT/Vite. The submitted extension
contains generated JavaScript, so this source archive is supplied for AMO review.

## Build environment

- Node.js 22
- npm bundled with Node.js 22

All build tools and dependencies are open source and are fetched from the npm registry using
the committed `package-lock.json`. No environment variables, private packages, web-based build
tools or external services are required.

## Reproduce the Firefox package

From the directory containing this file:

```sh
npm ci
npm run zip:firefox
```

The extension package is written to:

```text
dist/expired-domains-<version>-firefox.zip
```

The unpacked build is written to `dist/firefox-mv2/`. The second ZIP created by WXT is the
source archive and is not part of the extension package.

Country flags in `src/public/flags/` are committed SVG files copied into the package as they
are. They are taken from the open-source `flag-icons` package (MIT) and minified with SVGO by
`scripts/build-flags.mjs`; the Firefox build does not run that script.

The build performs ordinary TypeScript transpilation and bundling. Source code is not
obfuscated and the extension downloads no remote code at runtime. It makes no network
requests at all; `npm run check` fails if a network API appears in the built files.
