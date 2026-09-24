# n8n community node

## Overview
This is a project containing code for an n8n community node. n8n is a workflow
automation platform where users build workflows with nodes, which are the
building block of a workflow. Nodes can perform a range of actions, such as
starting a workflow (called a "trigger node"), fetching and sending data, or
processing and manipulating it. Besides that there are credentials - entities
that store sensitive information on how to connect to external services and
APIs. A node can require some credentials to be used. Community nodes are a way
for anyone to create such nodes and add them to be used in n8n. All community
nodes are named in a format: `n8n-nodes-<n>` or `@org/n8n-nodes-<n>`.
Community nodes can also be submitted for approval to be used on n8n Cloud
version. In that case there are rules that the node needs to follow in order to
be approved

## This repository

The n8n community node for the Crustdata API: two nodes (`Crustdata`, a declarative node, and
`CrustdataTrigger`, a webhook trigger) plus one credential. Everything below overrides the
generic n8n guidance in the rest of this file.

### Commands

```bash
npm test              # builds first via pretest, then vitest
npm run lint          # n8n-node lint, must be clean
npx tsc --noEmit      # must be clean
npm run gen:fields    # regenerate the spec tables; gen:fields:check is the CI drift gate
```

**Tests import from `dist/`, not from source.** `pretest` builds, so `npm test` is always
right, but a bare `npx vitest` tests whatever was last built. A run with no `Tests` line never
happened; it is not a pass.

### Rules

- **Never hand-edit `nodes/Crustdata/filter-fields.generated.ts`.** It is generated from the
  published OpenAPI spec by `scripts/gen-filter-fields.mjs`, committed, and drift-checked in
  CI. Change the generator and regenerate.
- **Never invent a Crustdata field, column or enum value.** They come from the spec or from a
  live call, never from memory.
- **No legacy APIs.** Nothing may reach `/screener` or `/v1`; a test enforces it and pins the
  credential's `API_VERSION` to the generated `SPEC_VERSION` so the two cannot drift.
- **Verify against the live API before encoding a constraint**, including constraints the spec
  states. Three of the web surface's documented behaviours were wrong when checked. Where a
  guard exists because of a live check, its comment says so and carries the date.
- **Do not ship a control bound to nothing.** A picker value, filter or flag that returns an
  empty result on every call is worse than its absence, because it fails silently. Leave it
  out and pin the exclusion with a test so an upstream fix is re-checked.
- **Guards run before dispatch, never after.** A wrong value should cost nothing, not a round
  trip and a 400. Errors name the nearest valid alternatives.
- **The response is relayed verbatim.** `usage` is the only key the node adds. Nothing is
  flattened, renamed or unwrapped except behind an explicit toggle.
- **A new test earns its place by failing.** Change the code to break it and watch it go red
  before committing; a test that passes either way is worse than none.
- Comments carry the non-obvious *why* and nothing else. Prefer no comment, then one line that
  fits, then a wrapped block.
- Atomic commits, one logical change each, no co-author trailers.

### Where things live

| Path | What |
|---|---|
| `nodes/Crustdata/resources/<name>/` | one resource's operations and properties |
| `nodes/Crustdata/filter-fields.generated.ts` | generated spec tables, never hand-edited |
| `nodes/Crustdata/{filters,sort,fields,pagination,response,usage}.ts` | shared property builders |
| `nodes/Crustdata/{diagnostics,geo-formats}.ts` | nearest-valid suggestions and value-shape guards |
| `nodes/CrustdataTrigger/` | the webhook trigger, including HMAC verification |
| `tests/node.test.js` | the whole suite; it runs against `dist/` |

## Important notes
- Follow the **rules and guidelines in this document and the linked docs
  below** over any code examples.
- All code blocks in these docs are **illustrative and incomplete**.
  They **MUST NOT** be copied verbatim or assumed to be the final desired code.
- Replace example names like `Example`, `Wordpress`, `wordpressApi`, etc.
  with names that match the **actual service / node** you are building.
- When in doubt, **generalize from the patterns**, don't replicate the exact
  structure, fields, or values from the examples.
- Produce the **full implementation** needed for the current project
  (nodes, credentials, tests, etc.), not just fragments similar to examples.
- If an example omits parts (e.g. types, operations, properties), **infer and
  implement the missing parts** based on the real requirements / API docs.
- Never output `Wordpress`-specific code unless the project is actually about
  WordPress.

## Project structure
There are two main folders in this project:
- `nodes` contains all of the nodes in a package (there can be more than 1).
  The code for each node usually lives in its own folder
- `credentials` contains all of the credentials in a package. Usually it's just
  a single file for every credential
So it looks something like this:
.
├── nodes/
│   └── Example/
│       ├── Example.node.ts
│       └── ...
├── credentials/
│   └── Example.credentials.ts
├── package.json
└── ...
It's important to note that `package.json` has a special field `n8n` that have
information about nodes and credentials in a package:
```json
{
  "name": "n8n-nodes-example",
  "version": "1.0.0",
  "n8n": {
    "n8nNodesApiVersion": 1,
    "strict": true,
    "credentials": [
        "dist/credentials/Example.credentials.js"
    ],
    "nodes": [
      "dist/nodes/Example/Example.node.js"
    ]
  }
}
```
`nodes` and `credentials` keys contain paths to transpiled JS files in a `dist`
folder for the nodes and credentials respectively. If you add/remove/rename
nodes and/or credentials, you need to make sure to update `n8n.nodes` and
`n8n.credentials` keys in `package.json` accordingly. Initial files in the
project _may_ contain example nodes and/or credentials that need to be
**removed or renamed** once you start making an actual node.

## Key guidelines
- Use the `n8n-node` CLI tool **whenever possible** for building, dev mode,
  linting, etc.
- **Always** address any lint/typecheck errors/warnings, unless there is a
  **very specific reason** to ignore/disable it
- Make sure to use **proper types whenever possible**
- If you are updating the npm package version, make sure to **update
  CHANGELOG.md** in the root of the repository
- Read `.agents/workflow.md` for more info

## Context-specific docs
Load these before working on the relevant area:

| Working on...                        | Read first                                                          |
|--------------------------------------|---------------------------------------------------------------------|
| Any node file in `nodes/`            | `.agents/nodes.md` and `.agents/properties.md`                      |
| A declarative-style node             | above + `.agents/nodes-declarative.md`                              |
| A programmatic-style node            | above + `.agents/nodes-programmatic.md`                             |
| Files in `credentials/`              | `.agents/credentials.md`                                            |
| Adding a new version to a node       | `.agents/versioning.md`                                             |
| Starting a new task or planning      | `.agents/workflow.md`                                               |

## Additional resources
If you need any extra information, here are links to n8n's official docs
regarding building community nodes:
- https://docs.n8n.io/integrations/community-nodes/build-community-nodes/
- https://docs.n8n.io/integrations/creating-nodes/overview/
- https://docs.n8n.io/integrations/creating-nodes/build/reference/
- https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/
