# Changelog

All notable changes to this node are recorded here. Versions follow
[semver](https://semver.org); the node's own `typeVersion` is separate and changes only
when a parameter's meaning changes for workflows already saved.

## [Unreleased]

First release. Nothing here has shipped before, so it is all new.

### Added

- **Person**: Search, Enrich, Contact Enrich.
- **Company**: Search (filters, a plain-language query, or both), Enrich, Identify.
- **Job**: Search, over the same condition builder, Sort, Return All and field picker as the
  other searches, plus **Aggregations**, `count` and `group_by`, over the whole match rather
  than the page. **Aggregations Only** sends `limit: 0`, so sizing a market costs nothing per
  result. Groupable columns are a much smaller set than filterable ones and are validated
  against their own list. Unlike person and company, job search requires no filters.
- **Social Post**: Search over the indexed post dataset: 67 filterable columns across the
  post, its author, engagement, reactors, commenters, mentions and attachments. **Count
  Only** sends `limit: 0`, which this endpoint answers for free while every returned post is
  billed. Enabled per account, so a 403 is an entitlement; the node says so rather than
  letting it read as a bad request.
- **Web**: Search and Fetch. Search takes a query, sources, a site restriction, an ISO 3166-1
  alpha-2 country and a published-date range; Fetch takes up to 10 URLs. Priced per request
  rather than per result: a credit per page of search results and a credit per URL fetched,
  including URLs that fail. The Sources picker offers four of the spec's seven values,
  live-checked 2026-09-24: `social` answers 200 with zero rows for any query and both
  scholar-article values answer 500, so offering them would be a control that returns
  nothing. The spec's enum is generated into the tables and a test fails if it changes, so an
  upstream fix gets re-checked rather than missed.
- **Watch**: List, Get, Preview, Test, Update, Cancel, Get Runs and Get Run, the watch
  surface the Trigger does not reach, all free. Preview dry-runs a track condition before
  any watch exists, which matters because `track` is immutable afterwards and a wrong rule
  fails by never firing. Preview and Test default Deliver **off**, against the API's own
  default, so checking a rule cannot fire a real webhook. Get, Cancel, Update, Get Runs and
  Get Run address a watch by ID alone: the `/watch/{id}` routes resolve either kind and
  report their own `kind` and `dataset`, so naming it would ask the caller to state what the
  ID already determines, and a wrong guess is a 404 that reads as an empty result.
- **Batch**: Submit, Get and List. Submit answers with a `batch_id` rather than records;
  `webhook_url` defaults to this execution's resume URL, so a Wait node set to *On Webhook
  Call* resumes the moment the job finishes instead of polling. Each endpoint names its own
  size cap, generated from the spec: they run from 10 to 10,000 identifiers per job, against
  25 for the synchronous operations. **Cursor** on List, so the second page is reachable.
- **Account**: Get Credits and Get Endpoints, plus four usage reports, all free. Get Usage
  Summary adds up requests, credits, errors and results over a window, split by day, product,
  endpoint or charge component; Get Usage Events is the same request by request, with the
  components that make up each charge; Get Usage Errors groups failures by endpoint and masked
  message; Get Usage Event opens one request, with the body, query and headers it was sent
  with. The three that take a window share a limit of 60 requests a minute. Get Usage Event
  addresses a templated path, which Raw cannot reach at all, so without it the
  `example_event_id` an error group hands you is a dead end.
- **The usage summary's daily rollups are checked before dispatch.** Over a window of whole UTC
  days, which is what the default window is, the summary is answered from daily totals that do
  not carry every dimension: grouping by Component then admits only Day, Product and the
  Products filter beside it, and the Status Codes and Error Type filters are refused outright.
  An hourly bucket or a window that starts or ends part way through a day reads every request
  and accepts all of it. Every branch of that was run against the live API before it was
  encoded.
- **Discover**: lists the operations and every filterable, sortable and returnable column,
  plus this account's own prices and rate limits, answered from the generated tables and a
  free carrier call so it costs no credits.
- **Raw**: call any of the 26 synchronous endpoints with a body you write. Batch and watch
  are excluded: each answers with a handle a one-shot request cannot redeem.
- **Crustdata Trigger**, a second node. Activating creates a watch pointed at n8n's webhook
  URL and deactivating deletes it. Entity watches track a list you name; discovery watches
  re-run a search.
- A filter builder over the API's own columns and operators, with live autocomplete on
  values.
- **Sort** over the sortable columns only, which is a strict subset of the filterable ones.
- **Return All**, paging on `next_cursor`. The budget is Max Results rather than Max Pages,
  because search bills per result.
- **Include Usage**, on by default: `usage.creditsUsed` and the rate-limit headers ride on
  every item unless you turn it off. A caller that cannot see what it spent cannot bound it,
  and a model driving the node sees no price anywhere else, because n8n derives a tool
  description from the operation's `action` alone.
- **Exclude Profile URLs** and **Exclude Names** on Person Search, which send the API's
  `post_processing` exclusions. Sent whole or not at all: an empty exclusion is no
  exclusion rather than an empty key.
- **Verified Business Emails Only** on Contact Enrich, which re-checks deliverability at
  request time for 0.5 credits more per matched person who receives one.
- The 25-value cap is stated on every identifier operation, and the way past it is too:
  Aggregate alone joins every input item, so above 25 rows it builds one oversized call the
  API refuses, and the shape that works is Loop Over Items at batch size 25 with the
  Aggregate inside. All four identifier operations were checked live: a 26th value is a 400
  naming the field and the count, charged nothing.
- Pre-dispatch validation of every column against its own vocabulary, with nearest-valid
  suggestions. A wrong column costs nothing instead of a round trip and a 400. Web Search's
  page aggregation is checked the same way: above one page the API merges within a single
  source only and refuses a selection of two or more, while sending none is accepted and
  searches them all, which its own message ("requires exactly one source") does not say.
- Hints on both nodes. Turning on Return All says a search bills per row, that some columns
  cost extra to filter on and not only to return, and that Discover reports your account's
  own rates for free. The Trigger points at **Watch > Get Runs**, which lists runs whose
  delivery never reached n8n and is the only place a missed notification survives.
- `usableAsTool`, so an n8n AI Agent can call the node directly.

### Notes

- `posts` joined `RESULT_KEYS` in the same change that added Social Post, and a test now
  pins every envelope key the node's searches return. A missing one fails twice and
  silently: Split Results does nothing, and the Return All row counter reads zero, which the
  no-rows guard turns into stopping after page one.

- Watch paths have one asymmetry worth knowing: entity and discovery are separate trees, but
  a discovery watch reads its **runs** with the `search/` segment dropped, on the
  entity-shaped path. Both nodes build these from one module so the two cannot drift.

- The Trigger verifies Crustdata's HMAC signature over the raw request body on every
  delivery, rejects anything older than five minutes, and answers a bad delivery with a
  401. Redeliveries are not de-duplicated; key on `x-crustdata-event-id` downstream if
  that matters.

- The response is relayed exactly as the API returned it. Search keeps its envelope by
  default so `total_count` and `next_cursor` survive; **Split Results Into Items** is opt in.
- Field lists, operators and endpoint tables are generated from the published Crustdata
  OpenAPI `2025-11-01` spec. CI fails on drift.
