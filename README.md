# n8n-nodes-crustdata

This is an n8n community node. It lets you use [Crustdata](https://crustdata.com) in your n8n
workflows.

Crustdata is a B2B data API covering 800M+ professional profiles and 200M+ companies, with
employment history, headcount over time, funding, job postings, social posts, work emails and
phone numbers.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/)
workflow automation platform.

* [Installation](#installation)
* [Operations](#operations)
* [Credentials](#credentials)
* [Usage](#usage)
* [Costs](#costs)
* [Crustdata Trigger](#crustdata-trigger)
* [Compatibility](#compatibility)
* [Resources](#resources)
* [Version history](#version-history)
* [License](#license)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation, or install it from the panel:

1. Go to **Settings > Community Nodes**
2. Select **Install**
3. Enter `n8n-nodes-crustdata` in **Enter npm package name**
4. Agree to the [risks](https://docs.n8n.io/integrations/community-nodes/risks/) of using
   community nodes
5. Select **Install**

## Operations

| Resource | Operations |
|---|---|
| **Person** | Search, Enrich, Contact Enrich |
| **Company** | Search, Enrich, Identify |
| **Job** | Search, with aggregations |
| **Social Post** | Search |
| **Watch** | List, Get, Update, Cancel, Test, Preview, Get Runs, Get Run |
| **Batch** | Submit, Get, List |
| **Account** | Get Credits, Get Endpoints, Get Usage Summary, Get Usage Events, Get Usage Errors, Get Usage Event |
| **Web** | Search, Fetch |
| **Discover** | Describe |
| **Raw** | Request, for any of the 26 synchronous endpoints |

Find people by where they work, what they do, where they studied or when they were hired. Find
companies by headcount, funding, hiring or technologies. Turn a messy company name into a real
record. Add work emails and phone numbers to a list you already have. Search the live web, or
fetch the pages behind the results, for anything the datasets do not cover.

Every search uses the same condition builder, with pickers for the filterable columns, the
operator set the API accepts, and live suggestions for real values. **Sort** covers the sortable
columns only, and **Return All** pages on `next_cursor`.

**Discover** lists every filterable, sortable and returnable column for a resource, and what
your account pays. It costs nothing, and is the quickest way to find out what you can query.

**Account** answers what you have already spent. Get Usage Summary adds up requests, credits,
errors and results over a window, split by day, product, endpoint or charge component. Get
Usage Events is the same thing request by request, each with the components that make up its
charge. Get Usage Errors groups what failed by endpoint and masked message, and hands you an
`error_key` to feed back to Events and an `example_event_id` to open with Get Usage Event,
which returns the body, query and headers that request was sent with. All four are free.

Responses come back exactly as the API sent them. Nothing is flattened or renamed, so what the
API docs describe is what arrives in the next node. The only key the node adds is `usage`, and
you can turn it off.

## Credentials

You need a Crustdata API key. Sign up at [crustdata.com](https://crustdata.com); the key is in
your dashboard.

In n8n, create a **Crustdata API** credential and paste the key in, then press **Test**. The
check calls a free endpoint, so it costs you nothing.

Use this credential rather than a generic Bearer Auth one. Crustdata needs an `x-api-version`
header as well as the key, and a request without it is rejected *after* authentication
succeeds, with `400 Missing required header: x-api-version`, which is a confusing way to spend
an afternoon.

## Usage

### Worked example

Find people at a company and get their work emails, in three nodes:

1. **Crustdata**, Person > Search. One condition:
   `experience.employment_details.current.company_website_domain` equals `stripe.com`. Turn on
   **Split Results Into Items**.
2. **Aggregate**, built into n8n, collecting the profile URL field into a list.
3. **Crustdata**, Person > Contact Enrich, with **Profile URLs** set to that list joined by
   commas.

Step 2 is the part worth copying. Every identifier operation takes up to 25 values, so
aggregating first spends one call instead of one per person. Contact Enrich is rate limited to
15 requests a minute, so 100 people one at a time is about seven minutes of waiting.

Past 25 rows, wrap steps 2 and 3 in **Loop Over Items** with batch size 25. Aggregate on its own
joins every item, builds one oversized call, and the API refuses it.

### Gotchas

* **A short page does not mean the end of the results.** Person Search's **Exclude Profile
  URLs** and **Exclude Names** run after the page is drawn, not as filters, so a page arrives
  short. Return All knows this and pages past the gap.
* **Some datasets are switched on per account.** Social Post Search and Company Search's ranked
  **Query** mode both answer 403 if yours does not have them. That is a question for your
  account manager, not a broken request.
* **Ranked Company Search cannot sort or page.** It returns one relevance-ordered window capped
  at 100, so the node hides those controls rather than letting you set up a guaranteed error.
* **Batch does not return records.** Submit answers with a `batch_id`. Put a **Wait** node set
  to *On Webhook Call* after it and the workflow resumes when the job finishes, instead of you
  polling. Caps run from 10 identifiers to 10,000 depending on the endpoint.
* **Wrong values are caught before the request goes out**, where they cost nothing. An unknown
  column comes back with the nearest real ones. A reversed range operator is caught, because
  Crustdata's are `=>` and `=<` and everyone types `>=` first. A country name in a column that
  wants an ISO-3 code is caught, because that one quietly returns zero rows instead of failing. A
  usage summary asking daily totals for something only the hourly ones hold is caught, because
  the default window is whole days and that is where it bites.

### AI Agent

The node is `usableAsTool`, so it attaches to an AI Agent. One node is one operation, because
n8n resolves the Resource and Operation statically, and n8n's automatic tool description does
not carry pricing, so set the Tool Description yourself.

For open ended agent work the [Crustdata MCP server](https://docs.crustdata.com) fits better:
the same API behind three tools, with schema discovery and per-call credit reporting.

## Costs

Identify, every Watch operation, every Account operation, including the four usage reports,
and Discover are free. Searches bill
per result, so **Max Results** under Return All is your spend ceiling as much as your size one.

Some columns cost extra to filter on or return, and rates are per account. **Discover** reports
yours, for free.

**Web** is priced by request rather than by result: Search is a credit per page of results, so
Pages is a multiplier, and Fetch is a credit per URL, including URLs that come back failed.

**Contact Enrich is the one to watch.** It bills per contact type actually returned, per person
matched: business emails 1 credit, personal emails 2, phone numbers 2, capped at 5. Asking for
nothing in particular asks for all three, so the API's own default is its most expensive
request. This node asks for business emails alone unless you widen it, and widening it is what
widens the bill.

Two ways to look before you spend. **Count Only** on Social Post Search and **Aggregations
Only** on Job Search return the number of matches without returning any rows, for free. And
**Include Usage** puts the credits spent on every item that comes back.

## Crustdata Trigger

A second node that starts a workflow when the data changes. Activating it creates a watch on
your account pointed at n8n's webhook URL; deactivating deletes it.

* **Entities** track a list of people or companies you name, and fire when one changes.
* **Discovery** re-runs a search on a schedule, and fires when something newly matches.

**Check the rule before you activate.** A watch's `track` is fixed once it exists, and a wrong
rule fails by never firing rather than by erroring, so there is nothing to debug afterwards.
**Watch > Preview** on the main node dry runs it against a sample record, for free, without
creating anything.

Every delivery is verified before it starts a workflow: HMAC-SHA256 over the raw body keyed by
your API key, with anything older than five minutes rejected and anything unsigned answered 401.
Redeliveries are not de-duplicated, so if a repeat would cause harm, key on the
`x-crustdata-event-id` header downstream.

**Watch > Get Runs** on the main node lists every run a watch has had, including ones whose
delivery never reached n8n. A missed notification is recoverable there and nowhere else.

## Compatibility

Requires an n8n version with community node support. Built and linted against `@n8n/node-cli`
0.48. No runtime dependencies.

11 of the 26 synchronous endpoints are reached through **Raw**, where you write the JSON body
yourself: the six live `professional_network` endpoints, the three autocompletes,
`dev_platform` and `employee_review`. Raw checks the endpoint against an
allowlist, but it has none of the column checking the first-class operations give you. These
become first-class operations over time.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [Crustdata API documentation](https://docs.crustdata.com)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
