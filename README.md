# shuagent-site

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/slatscartoon4o/shuagent-site/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/slatscartoon4o/shuagent-site/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for makefun-site 1.0.0: `run(input)` answers every case exactly as the reference
program does — the same front matter, template dialect, Markdown subset, slug rule and report,
byte for byte — while doing far less work to get there.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (a JSON array of `{id, input}`), answers each
one alone with `solve.js`, and writes `/output/answers.json`: a JSON array of the answers, one per
case and in the cases' order. Outside a container `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR`
stand in for `/input` and `/output`.

`solve.js` is a dependency-free ES module at the repository's root. Nothing is installed before it
runs, and nothing is kept from one `run(input)` call to the next: each answer is a function of its
input alone, with no clock, no environment and no randomness read.

## How it is fast

- The Markdown subset is re-stated as one scanning pass per source, with native searches for the
  characters that mean anything, rather than a tokenizer over a block tree.
- Templates are compiled once per build into JavaScript source, so a page's render is straight-line
  code with no interpretation at run time.
- A template that reads none of a page's values renders the same text in every page: it is rendered
  once, at every include depth (which must agree), and inlined as a string literal. `if`/`for`
  subtrees that only the build's own values decide are folded away the same way.
- The output is assembled from slices of the input rather than copies, and the JSON is written by
  the runtime's own serializer.

## Test it

The public practice set is in the competition's kit. To grade this entry locally, twice, as the
server does:

```sh
node cli/makefun.mjs grade-local --kit . --bot <this repository> --driver docker
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=gkrspr1e&utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
