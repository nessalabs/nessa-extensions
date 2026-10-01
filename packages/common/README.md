# @nessalabs/common

Logic that more than one extension needs: domain types, validation,
formatting. No UI — no DOM, no React, no Node — so its `tsconfig.json` gives
it ES2022 and nothing else. Primitives, shared components, and reused UI
composites belong in `nessa_ui` (`@nessalabs/ui`), not here.

An extension that uses it names it in its manifest (`"@nessalabs/common":
"workspace:*"`), and its build bundles it in, so the published extension
installs and runs on its own. It is private and is not published (see the
[repository's decision record](../../docs/adr/todo/1-extensions-repo.md)).

Until an extension needs something here it is empty, and its test says so.
