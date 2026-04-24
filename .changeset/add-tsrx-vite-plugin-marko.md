---
'@tsrx/vite-plugin-marko': minor
---

Add `@tsrx/vite-plugin-marko`, a Vite plugin that compiles `.tsrx` files to Marko Tags API source via `@tsrx/marko`. Works alongside `@marko/vite`, which handles the `.marko` → JS stage. Currently supports single-component `.tsrx` files; multi-component files must be split across separate `.tsrx` files so Marko's filesystem tag discovery can resolve them.
