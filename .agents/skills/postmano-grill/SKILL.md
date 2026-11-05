---
name: postmano-grill
description: Stress-test a plan against postmano's own domain language and recorded decisions, in rounds over a design tree — challenges it against CONTEXT.md, sharpens terminology, and writes CONTEXT.md entries and docs/adr/ ADRs inline, in this repository's format. Use when grilling a plan inside the postmano repository, as in `/postmano-grill <what you want to grill>`.
---

<what-to-do>

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round. A frontier of one question is one question — the round is whatever the tree allows, never a quota to fill.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact this repository already holds — what a route answers today, which ADR settled a boundary, whether `CONTEXT.md` already names the term — go and read it instead of asking. Read it yourself with the ordinary tools: this repository does not dispatch sub-agents unless the user asks for one. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

When the frontier is empty, the final round carries one more question, always the last one: what happens once the change is implemented. Ask it in the same format as every other question:

```
❓ **Qn** - **After implementing**: once the change is built and the gates pass, do I ship it straight away, or hold it for you first?

1. **Ship it** — create the branch, commit, push and open the pull request as soon as it is done.
2. **Hold for review** — stop with the work uncommitted so you can read the diff and test it on localhost (`bun run up`); create the branch, commit, push and open the pull request only once you confirm.

➡️ <your recommended answer>
```

Whatever the answer, the work goes on a branch and lands through a pull request — never a commit on `master`. If the answer is to hold, report the change as ready for review and wait: an approval given before the user has looked at it is not the confirmation this question asks for. The answer covers this session's change and nothing after it. If the user's own rules forbid you to commit or push, do not offer option 1: hand over the commands instead.

</what-to-do>

<supporting-info>

## Where postmano keeps its knowledge

Read these before you ask a question they could answer:

- `CONTEXT.md`: the domain language (workspace, collection, publication, ...) and the words the screen shows.
- `docs/adr/`: every decision that would surprise a reader of the code. Read the most recent one before writing a new one.
- `AGENTS.md`: the rules for changing the repository (language, code, tests, commits).
- `docs/produto/escopo-mvp.md`: what is in, later and out of the product.
- `docs/deploy.md`: what runs on AWS and what the infra team prepares.
- The code itself, when the user states how something works: check that it agrees.

`CONTEXT.md` has one context for the whole repository. Create other files lazily, only when you have something to write.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'workspace' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'link' — do you mean the Publication, or the address it has?"

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts: a viewer opens a public page, a folder is moved after it was published, two people save the same collection at once.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code hides secret variables on a page, but you just said the environment is shown — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up — capture them as they happen. Follow the shape `CONTEXT.md` already uses: a `**Term**:` line under `## Language`, a short definition in English, the pt-BR word the screen shows when it differs (`Screen word: "Coleção"`), and an `_Avoid_:` line naming the synonyms nobody should use for it. Read the neighbours before adding one.

Don't couple `CONTEXT.md` to implementation details. Only include terms that are meaningful to the people who use the product.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Follow the shape of the most recent one in `docs/adr/` (0002): `NNNN-slug.md`, numbered one past the highest, opening `# ADR NNNN: Title`, then `Status: accepted, <date>.`, `## Context`, `## Decision` and `## Consequences`. Write them in English.

## Things worth grilling here

Plans in this repository usually touch one of these, and each has a decision already recorded or still open:

- `{{variable}}` in headers, body and address: where it is filled in, what an empty one does, whether the editor helps to write it.
- The environment: how a person picks it, what a secret value does on a published page.
- Who may open a published page, and what is checked on every open (ADR 0002).
- Where a request is sent from, the server or the browser (ADR 0001).

</supporting-info>
