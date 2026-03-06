# Trust Tier Policy: Create Template Project

## Tier Definitions

**Current Tier:** 1 — Informed (High Autonomy)

**Justification:**

This intent qualifies for Tier 1 based on the following risk assessment:

**Work Type Classification:**
- **Category:** Project scaffolding and development infrastructure setup
- **Nature:** Foundational template creation with no active runtime dependencies or user data
- **Reversibility:** Fully reversible — Git reset to any prior state with zero data loss or service impact

**Blast Radius:**
- **Scope:** Repository-local only; affects no deployed services, live users, or production data
- **Impact Surface:** Development workflow and future developer experience
- **Failure Mode:** Worst case is unusable template requiring recreation — zero user-facing impact
- **Dependencies:** No external services, APIs, or production systems involved

**Domain Sensitivity:**
- **Security Posture:** No authentication, authorization, or sensitive data handling
- **Compliance Requirements:** None — no PII, payment data, or regulated information
- **Trust Boundaries:** No new network boundaries, service integrations, or security perimeters introduced

**Tier 1 Rationale:**
This work operates with high autonomy because:
1. Complete reversibility through Git version control
2. No production deployment or live user impact
3. Observable but low-risk — review happens after execution
4. Well-defined verification protocol catches errors before human review
5. Standard React ecosystem patterns reduce novelty risk
6. No cross-domain coordination required

**Disqualifiers from Tier 0 (Autonomous):**
- Establishes architectural patterns that constrain future work — requires human observation
- First orbit in new trajectory — no historical performance data to support full autonomy
- Defines tooling choices (Vite, TypeScript, ESLint) with long-term implications

**Disqualifiers from Tier 2 (Supervised):**
- No state mutation affecting users or production systems
- No security-critical flows (auth, payments, PII)
- No database migrations or schema changes
- No external service integrations with trust boundaries

## Promotion Criteria

### Promotion Path: Tier 1 → Tier 0 (Informed → Autonomous)

**Eligibility Window:** After 10 completed orbits of similar work type (project scaffolding, infrastructure setup, development tooling configuration)

**Quantitative Requirements:**
- **Consecutive Successful Orbits:** Minimum 10 orbits without re-orbit or verification failure
- **Verification Pass Rate:** ≥ 95% over 20-orbit evaluation window
- **Drift Rate:** ≤ 5% (execution matches proposal in 95%+ of orbits)
- **Average Cycle Time:** ≤ 120 minutes from proposal to verification completion
- **Re-orbit Frequency:** ≤ 1 re-orbit per 10 orbits
- **Human Intervention Rate:** Zero manual corrections during verification phase in last 10 orbits

**Qualitative Conditions:**
- Pattern library for React project scaffolding is mature and documented
- Context packages for this work type achieve consistent grounding (no ambiguity signals in orbit logs)
- No unresolved incidents or post-orbit corrections traced to this work type
- Verification protocols demonstrate comprehensive coverage (no missed failure modes in retrospective analysis)

**Approval Process:**
1. System generates promotion recommendation when quantitative criteria are met
2. Trajectory Lead reviews orbit log evidence over evaluation window
3. Approval requires written justification citing specific orbit IDs demonstrating pattern maturity
4. Policy update logged in Trust Tier Policy evolution log with evidence references

**Accelerated Promotion (Optional):**
If a work type reaches 20 consecutive successful orbits with zero drift and 100% verification pass rate, promotion eligibility triggers after 15 orbits instead of 20. Trajectory Lead may approve early promotion with documentation of exceptional performance.

### Promotion Path: Tier 2 → Tier 1 (Future Regression Scenario)

If this work type is demoted to Tier 2, re-promotion to Tier 1 requires:
- **Consecutive Successful Orbits:** 5 orbits post-demotion without failure
- **Pass Rate:** ≥ 90% over 10-orbit window
- **Drift Rate:** ≤ 10%
- **Root Cause Resolution:** Documented fix addressing demotion trigger cause
- **Cooldown Period:** Minimum 5 orbits at Tier 2 before re-promotion eligibility

## Demotion Triggers

### Automatic Demotion: Tier 1 → Tier 2 (Supervised)

The following conditions trigger immediate, non-negotiable demotion:

**Verification Failures:**
- **Trigger:** Any automated gate failure (AG-01 through AG-08 in Verification Protocol)
- **Action:** Immediate demotion to Tier 2 for next orbit of this work type
- **Cooldown:** 5 orbits minimum at Tier 2 before re-promotion eligibility
- **Automatic:** Yes — no human review required for demotion activation

**Security Incidents:**
- **Trigger:** Introduction of security vulnerability detected post-orbit (dependency with known CVE, exposed credentials, insecure configuration)
- **Action:** Immediate demotion to Tier 2, incident review mandatory
- **Cooldown:** 10 orbits minimum, plus completion of incident post-mortem
- **Automatic:** Yes — security scanner findings trigger automatic demotion

**Excessive Drift:**
- **Trigger:** Drift rate exceeds 15% over any 10-orbit window (execution deviates from proposals in 15%+ of orbits)
- **Action:** Demotion to Tier 2
- **Cooldown:** 5 orbits at Tier 2 with drift rate < 10% required for re-promotion eligibility
- **Automatic:** Yes — calculated from orbit log data

**Re-orbit Frequency:**
- **Trigger:** More than 2 re-orbits in any 5-orbit sequence for this work type
- **Action:** Demotion to Tier 2
- **Cooldown:** 5 orbits at Tier 2 with ≤ 1 re-orbit before re-promotion eligibility
- **Automatic:** Yes — tracked via orbit log re-orbit reasons

**Human Override Rate:**
- **Trigger:** Manual corrections during verification phase in 3+ consecutive orbits
- **Action:** Demotion to Tier 2 for investigation
- **Cooldown:** 5 orbits, plus root cause analysis documenting context package or proposal quality improvements
- **Automatic:** No — requires human judgment to distinguish between AI error vs. evolving requirements

### Automatic Demotion: Tier 2 → Tier 3 (Gated)

If work is already at Tier 2 and experiences:
- **Production Incident:** Any orbit traced to production outage, data loss, or security breach → automatic demotion to Tier 3, minimum 20-orbit cooldown, incident post-mortem required
- **Repeated Tier 2 Failures:** 3+ verification failures while at Tier 2 within 10-orbit window → demotion to Tier 3, pattern investigation required

### Non-Automatic Review Triggers

These conditions do NOT trigger automatic demotion but flag the work type for Trajectory Lead review:
- **Escalating Cycle Times:** Average cycle time increases by > 50% over 10-orbit window
- **Context Package Churn:** Context package updated 3+ times for same work type in 5-orbit sequence (signals unstable grounding)
- **Novel Failure Modes:** Verification protocol misses failure mode discovered post-orbit (protocol update required, but no immediate demotion)

## Override Authority

### Role-Based Override Powers

**Trajectory Lead:**
- **Promotion Authority:** Can promote to Tier 0 (Autonomous) maximum
- **Demotion Authority:** Can demote to any tier
- **Justification Required:** Yes — written rationale citing orbit log evidence or risk assessment
- **Logging Requirement:** All overrides logged in orbit metadata with override reason, evidence citations, and timestamp
- **Audit Scope:** Overrides reviewed in monthly trajectory retrospectives

**System Architect:**
- **Promotion Authority:** Can promote to Tier 1 maximum (cannot grant Tier 0 autonomy for infrastructure work)
- **Demotion Authority:** Can demote to any tier
- **Justification Required:** Yes — must document technical risk assessment
- **Logging Requirement:** All overrides logged with technical justification
- **Audit Scope:** Overrides reviewed quarterly in architecture review meetings

**Emergency Override (Any Deploy Role):**
- **Promotion Authority:** None
- **Demotion Authority:** Can temporarily demote to Tier 3 (Gated) during active incidents
- **Duration:** 24 hours maximum — emergency override expires automatically
- **Post-Incident Requirement:** Trajectory Lead must review within 24 hours and either confirm demotion or restore previous tier with justification
- **Logging Requirement:** Mandatory logging with incident ID, timestamp, and override actor
- **Audit Scope:** Reviewed in incident post-mortems

### Override Scenarios

**Valid Override Conditions:**
1. **Novel Domain Risk:** Work type enters new technical domain not covered by existing tier definitions (e.g., first infrastructure-as-code work, first third-party integration)
2. **Incident Response:** Active production incident requires immediate reduction of autonomy to stabilize system
3. **Regulatory Change:** New compliance requirement affects risk profile of previously-approved work type
4. **Contextual Anomaly:** Specific orbit involves unusual constraints not captured by general tier policy (e.g., work during code freeze, work affecting shared library used by multiple teams)

**Invalid Override Conditions (Prohibited):**
1. **Schedule Pressure:** Cannot promote tier to "move faster" without data supporting safety
2. **Convenience:** Cannot demote tier because human prefers to review all work (use Tier 3 for work requiring human collaboration by design)
3. **Personality Preference:** Cannot adjust tier based on trust/mistrust of AI agent without objective evidence
4. **Single Failure Overreaction:** Cannot demote based on one orbit failure without pattern evidence (demotion triggers already define thresholds)

### Override Logging Format

All manual tier adjustments must be recorded in orbit metadata:

```yaml
override:
  timestamp: "2025-01-17T14:32:00Z"
  actor: "Trajectory Lead"
  action: "promote"
  from_tier: 1
  to_tier: 0
  justification: "10 consecutive successful orbits (ORB-001 through ORB-010), 100% verification pass rate, zero drift, pattern library mature per context package updates"
  evidence_references:
    - "ORB-001-verification-report.md"
    - "ORB-010-verification-report.md"
    - "orbit-log-analysis-2025-01.csv"
  reviewed_by: null  # Populated during next retrospective
  review_date: null
```

## Autonomy Boundaries

### Tier 1 (Current) — Informed Autonomy

**AI Agent MAY Execute Without Human Approval:**

1. **File Creation:**
   - Create all files specified in proposal (`package.json`, `vite.config.ts`, `tsconfig.json`, React source files, configuration files)
   - Create directory structure (`/src/`, `/src/components/`, `/src/styles/`, `/public/`)
   - Generate `.gitignore` with standard exclusions for Node.js projects

2. **Dependency Installation:**
   - Install exact package versions specified in proposal via `npm install`
   - Generate `package-lock.json` with locked dependency tree

3. **Configuration Authoring:**
   - Write build tool configuration (Vite settings, TypeScript compiler options, ESLint rules, Prettier formatting)
   - Set development server port, HMR settings, path aliases

4. **Code Generation:**
   - Implement React component hierarchy per proposal (root App component, sample components)
   - Write TypeScript interfaces and type definitions
   - Author initial styles (CSS/SCSS files per proposal)

5. **Documentation:**
   - Write README.md with setup instructions, available scripts, project structure overview
   - Add inline code comments explaining architectural decisions

6. **Git Operations:**
   - Commit all generated files with descriptive commit message
   - Push to feature branch per ORBITAL workflow

7. **Verification Execution:**
   - Run all automated gates (AG-01 through AG-08)
   - Execute `npm ci`, `npm run dev`, `npm run build`, `npm run lint`, `npm run type-check`
   - Generate verification report with pass/fail results

**AI Agent MUST Request Human Approval For:**

1. **Tooling Substitutions:**
   - Replacing Vite with alternative bundler (Webpack, Parcel, Rollup)
   - Changing package manager from npm to yarn/pnpm
   - Substituting React Router with alternative routing library

2. **Architectural Deviations:**
   - Adding state management library not in original proposal (Redux, Zustand, Jotai)
   - Introducing CSS-in-JS solution not specified in intent
   - Adding backend/API layer (template is frontend-only per constraints)

3. **Dependency Version Changes:**
   - Upgrading React beyond minor version specified in proposal (e.g., 18.2 → 19.0)
   - Downgrading any dependency due to compatibility issues
   - Adding dependencies not listed in original proposal

4. **Constraint Violations:**
   - Requiring external services (APIs, databases, authentication providers)
   - Adding dependencies with non-permissive licenses
   - Introducing manual setup steps outside version control

5. **Security-Sensitive Configuration:**
   - Creating `.env` files or environment variable requirements
   - Configuring CORS policies or security headers
   - Setting up authentication/authorization scaffolding

**AI Agent MUST Notify Human After Execution (Not Blocking):**

1. **Standard Execution Completion:**
   - All files created successfully, verification gates passed
   - Repository ready for human review at leisure (async notification)

2. **Non-Critical Warnings:**
   - Dependency peer dependency warnings during `npm install` (non-blocking if install succeeds)
   - ESLint warnings (non-errors) in generated code
   - Documentation TODO markers for future enhancement

3. **Performance Observations:**
   - Cycle time significantly faster/slower than estimated
   - Verification gate execution times outside expected ranges

**Escalation Path:**

If AI agent encounters ambiguity during execution:
1. Check proposal and context package for clarification
2. If still ambiguous, record decision reasoning in orbit log
3. Proceed with most conservative interpretation (least autonomy assumption)
4. Flag ambiguity in post-orbit notification for human review
5. If ambiguity affects constraint compliance, STOP and request human decision

### Tier 0 Boundaries (Future Autonomous State)

**Additional Permissions at Tier 0:**
- Execute without post-orbit notification (human reviews at their discretion via orbit log)
- Minor proposal adjustments during execution without re-orbit (e.g., fixing typos in generated code, adjusting import paths)
- Automatic re-orbit on verification failure without human intervention (max 1 re-orbit, then escalate)

**Still Requires Approval at Tier 0:**
- Anything currently requiring approval at Tier 1 (architectural changes, tooling substitutions, constraint violations)

### Tier 2 Boundaries (Demoted State)

**Reduced Permissions at Tier 2:**
- Human must approve proposal BEFORE execution begins (no execution until explicit approval)
- Human must review verification results BEFORE considering orbit complete
- No automatic re-orbit — human decides whether to re-orbit or close intent

**Escalation to Human is Immediate:**
- Any verification gate failure stops execution immediately
- Any ambiguity in proposal interpretation stops execution immediately
- Human must provide clarification or revision before execution resumes

---

**Policy Version:** TTP-INT-001-1  
**Effective Date:** 2025-01-17  
**Approved By:** [Awaiting Trajectory Lead Signature]  
**Next Review:** After orbit completion or upon demotion trigger