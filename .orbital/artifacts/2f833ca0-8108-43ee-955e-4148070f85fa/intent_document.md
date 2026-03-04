# Intent Document Generator

## What Is an Intent?

The Intent Document is the **atomic unit of desired outcome** in the ORBITAL system. It is the **single source of truth for what the human wants to achieve** — not how the AI should achieve it. An intent that prescribes implementation is a failed intent.

An intent captures **one discrete outcome** with its constraints, acceptance criteria, and trust tier. It is the starting point of every orbit.

### Where Do Intents Come From?

Intents can be authored by:

- **A human** — directly writing an intent from their own understanding of the desired outcome.
- **An AI agent** — decomposing a larger goal or conversation into discrete intents for human review.
- **A prior orbit** — learnings from a completed or failed orbit that surface new outcomes to pursue.

The source doesn't matter. What matters is that the intent passes validation: one outcome, no implementation leakage, testable acceptance, justified trust tier.

---

## Intent Schema

Every intent MUST contain exactly these four fields:

```yaml
intent: "<INT-nnn> <short_title>"
outcome: >
  A measurable, observable change in system behavior or user experience.
  Phrased as a result, never as a task. No implementation details.
constraints: >
  Hard boundaries the solution must not violate.
  Regulatory, contractual, security, compatibility, or performance limits.
acceptance: >
  Concrete, testable conditions that prove the outcome was achieved.
  Quantitative where possible (latency, scores, counts, error rates).
trust_tier: "<0–4> — <label> (<brief justification>)"
```

### Trust Tiers

| Tier | Label | Description | Example |
|------|-------|-------------|---------|
| 0 | autonomous | No human review needed; fully reversible, low blast radius | Update copy, toggle feature flag |
| 1 | informed | Human notified after execution; low-risk but observable | Add a read-only API endpoint |
| 2 | supervised | Human approves before deploy; touches sensitive flows | Payment, auth, PII handling |
| 3 | collaborative | Human and AI co-author; high ambiguity or novel domain | New pricing model, ML pipeline |
| 4 | human-led | Human drives; AI assists with research and drafting only | Legal compliance, org-level policy |

---

## How to Create Intents

### Step 1 — Identify Outcomes

From whatever source material you have — a conversation, a goal statement, a prior orbit's learnings — identify every **discrete, observable outcome**:

1. If working from a **document or specification**: Read the entire document. Identify every use case, scenario, feature, and acceptance criterion. Note domain boundaries.
2. If working from a **conversation or goal**: Ask *"What observable change does the human want?"* and decompose compound goals into independent outcomes.
3. If working from a **prior orbit**: Review the orbit log. Identify unresolved outcomes or new outcomes discovered during execution.

### Step 2 — Decompose into Atomic Outcomes

For each identified outcome, ask: *"What observable change does the human want?"*

- **Split** compound outcomes into separate intents when they have independent results or different trust tiers.
- **Merge** tightly coupled scenarios that share one outcome (e.g., UC-1.1 through UC-1.5 may be one intent if they all serve "workspace exists and is operational").
- **Discard** implementation details — architecture diagrams, data models, and tech choices do NOT appear in intents. Those belong in downstream artifacts (context packages, proposals).

### Step 3 — Write Each Intent

For every identified outcome, produce an intent block:

1. **outcome** — Rewrite the feature/use case as a measurable result. Remove any verbs that describe HOW (e.g., "build", "create endpoint", "add table"). Use verbs that describe WHAT changes ("enables", "reduces", "ensures", "prevents").
2. **constraints** — Extract hard limits: compliance rules, security requirements, backward-compatibility promises, SLAs, and non-negotiable boundaries. If the source is ambiguous, ask the human to confirm.
3. **acceptance** — Define testable statements that prove the outcome was achieved. Add quantitative thresholds when implied but not stated (e.g., if the source says "fast", propose a latency target). Flag any acceptance criteria you inferred with `[inferred]`.
4. **trust_tier** — Assign based on blast radius, reversibility, and sensitivity of the outcome.

### Step 4 — Validate

Run these checks on every intent before outputting:

| Check | Fail Condition |
|-------|---------------|
| **No implementation leak** | Intent mentions a specific technology, table name, API path, library, or architecture pattern |
| **Single outcome** | Intent describes two or more unrelated results |
| **Testable acceptance** | Any acceptance criterion is subjective or unmeasurable |
| **Constraints are boundaries** | A "constraint" is actually a requirement (move it to acceptance) |
| **Trust tier justified** | Tier assignment has no rationale |

If an intent fails validation, revise it before including it in the output.

---

## Output Format

Output a single markdown file with the following structure:

```markdown
# Intent Document — <project_name>

**Generated:** <date>
**Source:** <brief description of where the intents came from>
**Intent Count:** <N>

---

## INT-001: <Short Title>

- **outcome:** <outcome text>
- **constraints:** <constraints text>
- **acceptance:** <acceptance criteria>
- **trust_tier:** <tier number> — <label> (<justification>)

---

## INT-002: <Short Title>

...
```

### Numbering

- Intents are numbered sequentially: `INT-001`, `INT-002`, etc.
- If the source has domain groupings, prefix with the domain: `INT-A-001` (Domain A, intent 1).

### Grouping

- Group intents under their source domain heading when the source uses domain organization.
- Within each domain, order intents from foundational (must exist first) to dependent.

---

## Rules

1. **Never prescribe implementation.** If you catch yourself writing "use X", "create a Y table", or "call Z API" — delete it. The intent says WHAT changes, not HOW.
2. **One intent = one outcome.** If an intent has "and" connecting two unrelated results, split it.
3. **Constraints are non-negotiable.** They are walls, not goals. "Must not break PCI compliance" is a constraint. "Supports 3 payment methods" is acceptance.
4. **Acceptance is binary.** Each criterion is pass/fail. Avoid words like "should", "ideally", "nice to have".
5. **Trust tier reflects risk, not complexity.** A complex but safe refactor is tier 0. A one-line change to auth logic is tier 2.
6. **Inferred criteria are marked.** When the source is silent on a measurable threshold and you supply one, tag it `[inferred]`.

---

## Example

Given a goal: *"Reduce checkout form from 11 fields to 4 to improve conversion, must remain PCI compliant, cannot remove address for physical goods."*

```markdown
## INT-001: Streamlined Checkout Form

- **outcome:** Checkout conversion increases by reducing cognitive load at payment step — form fields decrease from 11 to 4.
- **constraints:** Must not violate PCI-DSS compliance; must retain address collection for physical-goods orders; must not remove any payment method currently supported.
- **acceptance:** Form renders in <200ms; all existing payment methods functional; accessibility score ≥ 95 (Lighthouse); conversion rate measured and baselined within 7 days of deploy `[inferred]`.
- **trust_tier:** 2 — supervised (touches payment flow, affects revenue)
```