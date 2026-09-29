# Changelog

All notable changes to this node are recorded here. Versions follow
[semver](https://semver.org); the node's own `typeVersion` is separate and changes only
when a parameter's meaning changes for workflows already saved.

## [0.1.0] - 2026-09-29

First release.

- **Crustdata** — Person, Company, Job, Social Post, Watch, Batch, Account, Discover and Raw.
  Searches take a filter builder over the API's own columns and page on `next_cursor`; enrich
  takes up to 25 identifiers a call; Raw reaches every synchronous endpoint the node does not
  model.
- **Crustdata Trigger** — starts a workflow when a watch fires. Deliveries are HMAC-verified.
- Filter, sort, groupable and returnable field tables are generated from the published
  OpenAPI spec, and CI fails on drift.
- Responses are relayed verbatim. `usage` is the only key the node adds, and it is opt in.
