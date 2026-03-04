# Trust Tier Policy — Intent T3-004

**Policy ID:** TTP-T3-004-1  
**Intent:** T3-004 · Build repository viewer page (frontend)  
**Trust Tier Assignment:** 2 — Supervised  
**Effective Date:** 2024-02-17  
**Project:** Prometheus V1  
**Trajectory:** Repository Viewer  

---

## Current Tier: Supervised (Tier 2)

### Classification Rationale

Intent T3-004 is assigned **Tier 2 (Supervised)** based on the following risk factors:

**Security Surface:**
- Introduces new repository data access patterns with potential path traversal vulnerabilities
- Handles user input (file paths, branch names) that could be exploited if not properly sanitized
- Creates client-side interfaces for sensitive repository operations (file access, branch navigation)
- Must enforce repository access boundaries aligned with project membership

**Blast Radius:**
- New subsystem with 14 new files and 3 modifications across core routing and API layers
- Introduces 3 external dependencies (syntax highlighter, diff renderer, virtual scrolling) with bundle size and security implications
- Performance-critical rendering path (10,000+ file trees) that could degrade user experience across the platform if poorly implemented
- Modifies project layout navigation, affecting all users accessing the project routes

**Complexity:**
- High complexity rating due to novel integration patterns (repository APIs, virtual scrolling, lazy loading)
- Requires coordination between multiple stateful components (branch selector, file tree, viewer, diff panel)
- Performance optimization mandatory (bundle size budget, virtual scrolling, lazy loading) — failure creates technical debt

**Reversibility:**
- Moderate reversibility — new routes and components can be removed, but navigation modifications and API client changes have cross-cutting impact
- Breaking changes to API contracts would affect backend repository service contracts
- Performance regressions (bundle bloat, memory leaks) may not be immediately apparent and require monitoring over time

### Tier 2 Characteristics

At **Tier 2**, this intent operates under the following constraints:

| Characteristic | Requirement |
|----------------|-------------|
| **AI Autonomy** | Moderate — AI generates complete proposal with implementation plan, risk analysis, and test strategy, then **waits for explicit human approval** before execution begins |
| **Human Role** | **Approves before execution** — reviews proposal for security gaps, architectural alignment, and risk mitigation adequacy; provides modifications or approval |
| **Execution Model** | Gated — no code generation, file creation, or dependency installation occurs until approval gate is cleared |
| **Review Focus** | Security validation (path sanitization, auth boundaries), performance budget compliance (bundle size, rendering optimization), API contract alignment |

---

## Approval Requirements

### Primary Approval Gate

**Who:** Trajectory Lead (Repository Viewer trajectory owner)  
**When:** After proposal generation, before orbit execution phase begins  
**Scope:** Full proposal review including:
- Implementation plan (file changes, order of operations)
- Risk surface assessment (edge cases, regressions, security, performance)
- Test strategy (coverage, integration tests, edge case validation)
- Scope estimate (files affected, complexity justification)

**Approval Criteria:**
- [ ] Security risks are identified with concrete mitigations (path sanitization, auth checks)
- [ ] Performance budget is addressed (bundle size < 500KB, lazy loading strategy defined)
- [ ] API contracts match backend repository service contracts (verified against API specs)
- [ ] Test coverage plan includes security edge cases (path traversal, injection) and performance scenarios (large trees, rapid branch switching)
- [ ] Scope boundaries are clear (no unplanned feature creep, no undocumented dependencies)

### Secondary Review (Conditional)

**Trigger Conditions:**
- External dependency introduces security vulnerability (CVE score ≥ 7.0)
- Bundle size estimate exceeds 500KB gzipped
- API contract changes require backend service modifications
- Implementation plan deviates from established frontend patterns

**Who:** System Architect or Security Lead  
**Scope:** Focused review on the specific concern:
- Security Lead for vulnerability assessment and mitigation validation
- System Architect for pattern deviation justification or API contract changes
- Performance Lead for bundle size exception review

### Automated Gates (Must Pass Before Human Review)

- [ ] **TypeScript validation** — `npm run type-check` passes with zero errors
- [ ] **Linting** — `npm run lint` passes with zero errors or warnings
- [ ] **Proposal schema validation** — All required sections present (interpreted intent, implementation plan, risk surface, scope estimate)
- [ ] **Context package completeness** — All referenced files exist, all dependencies are documented

---

## Autonomy Boundaries

### What the AI CAN Do Without Human Approval

**During Proposal Phase (Current):**
- Generate complete implementation plan with file-by-file breakdown
- Identify and document security risks, edge cases, and performance concerns
- Propose specific technical solutions (libraries, patterns, approaches)
- Estimate scope (file count, complexity, test cases)
- Query context packages for architectural patterns and existing code
- Request clarification on ambiguous requirements via structured questions

**During Execution Phase (After Approval):**
- Create and modify files listed in approved proposal
- Install dependencies specified in approved proposal (exact versions)
- Implement test cases defined in approved test strategy
- Generate commit messages following project conventions
- Execute build and test commands to validate implementation

### What the AI CANNOT Do Without Human Approval

**Proposal Modifications:**
- Add files not listed in approved implementation plan
- Introduce external dependencies not specified in proposal
- Change API contracts or request/response schemas
- Modify authentication or authorization logic
- Alter performance constraints or bundle size budgets

**Scope Expansion:**
- Implement features not described in intent T3-004
- Refactor existing unrelated components "while we're here"
- Change project-wide conventions or patterns
- Add new routes beyond `/projects/:projectId/repository`

**Security-Sensitive Operations:**
- Bypass or weaken authentication checks
- Add client-side credential storage (localStorage, sessionStorage)
- Implement direct Git operations in frontend
- Create new API endpoints without explicit specification

**Deviation from Approved Plan:**
- Swap approved library for alternative (e.g., Monaco instead of react-syntax-highlighter)
- Change component architecture (e.g., single component instead of atomic split)
- Skip approved test cases or reduce coverage targets
- Alter order of operations in a way that introduces untested intermediate states

### Clarification Protocol

When the AI encounters **ambiguity or missing information** during execution:

1. **Pause execution** — do not make assumptions or "best guess" decisions
2. **Document the question** — specific, actionable, with context
3. **Propose options** — 2-3 alternative approaches with tradeoffs
4. **Wait for human decision** — execution resumes only after explicit choice

Examples:
- "Proposal specifies 'syntax highlighting library' but not which one — Monaco (350KB, full IDE features) vs. react-syntax-highlighter (150KB, simpler)?"
- "API contract for `GET /repository/file` doesn't specify behavior for binary files — return error, return base64, or return metadata only?"

---

## Escalation Criteria

### Automatic Escalation to Tier 3 (Collaborative)

The following conditions **automatically escalate** this intent to Tier 3, requiring real-time human-AI collaboration:

| Trigger | Escalation Action |
|---------|------------------|
| **Security vulnerability discovered** — Approved proposal's dependency has CVE ≥ 7.0 published during execution | Pause execution → Surface vulnerability details → Human and AI co-create mitigation plan → Resume with new approval |
| **API contract mismatch** — Backend repository service API differs from assumed contract in proposal | Pause execution → Human confirms actual contract → AI regenerates affected portions of plan → Resume with new approval |
| **Performance budget violation** — Bundle size exceeds 500KB during build | Pause execution → Human and AI identify culprit → Co-create lazy loading or code-splitting solution → Resume with new approval |
| **Test failure in security-critical component** — Path sanitization, auth check, or injection tests fail | Pause execution → Surface failure details → Human reviews root cause → AI proposes fix → Resume with new approval |

### Manual Escalation to Tier 4 (Human-Led)

Trajectory Lead may **manually escalate** to Tier 4 if:

- Proposal reveals architectural inconsistency requiring design decision (e.g., whether repository viewer should support offline mode, sync with desktop Git client)
- Security model requires legal/compliance review (e.g., repository contains regulated data, requires audit logging)
- Performance requirements cannot be met within current technology choices (e.g., syntax highlighting 1GB files requires streaming architecture redesign)

At Tier 4:
- AI role becomes advisory — provides research, drafts options, surfaces tradeoffs
- Human drives all decisions — selects approaches, defines requirements, approves incremental steps
- Intent may be split into smaller intents at lower tiers after design is finalized

---

## Audit Trail Requirements

### Orbit Log Entries (Mandatory)

Every orbit for intent T3-004 MUST log:

```yaml
orbit_id: "ORB-T3-004-{n}"
intent_id: "T3-004"
trust_tier: 2
phase: "{intent|proposal|execution|verification|delivery}"
timestamp: "{ISO-8601}"
duration_seconds: 0

# Proposal Phase
proposal_id: "PROP-T3-004-{n}"
approval_status: "{pending|approved|rejected|modified}"
approved_by: "{user_id}"
approval_timestamp: "{ISO-8601}"
modifications: []  # List of changes requested before approval

# Execution Phase
files_created: []
files_modified: []
dependencies_added: []
tests_generated: []
commit_sha: ""

# Verification Phase
gates_passed: []
gates_failed: []
re_orbit_triggered: false
re_orbit_reason: ""

# Performance Metrics
bundle_size_kb: 0
build_time_seconds: 0
test_coverage_percent: 0.0
```

### Decision Log Entries (For Escalations)

When escalation occurs, log:

```yaml
decision_id: "DEC-T3-004-{n}"
orbit_id: "ORB-T3-004-{n}"
trigger: "{security_vulnerability|api_mismatch|performance_violation|test_failure|manual}"
timestamp: "{ISO-8601}"
context: ""  # What triggered the escalation
options_presented: []  # AI-proposed alternatives
decision_made: ""  # Human choice
decided_by: "{user_id}"
rationale: ""  # Why this choice
impact: ""  # What changed in the plan
```

### Human Modification Log

When humans modify AI proposals or execution artifacts, log:

```yaml
modification_id: "MOD-T3-004-{n}"
artifact: "{proposal|code|test|documentation}"
timestamp: "{ISO-8601}"
modified_by: "{user_id}"
change_type: "{addition|deletion|replacement|clarification}"
before: ""  # Original content (if applicable)
after: ""  # Modified content
rationale: ""  # Why the change was made
```

### Approval Gate Log

Track all approval gate transitions:

```yaml
gate_id: "GATE-T3-004-{n}"
orbit_id: "ORB-T3-004-{n}"
gate_type: "{proposal_approval|security_review|architecture_review|performance_review}"
timestamp: "{ISO-8601}"
reviewer: "{user_id}"
outcome: "{approved|rejected|conditional}"
conditions: []  # If conditional approval
feedback: ""  # Reviewer comments
```

---

## Verification Requirements

### Pre-Execution Verification (Proposal Phase)

Before orbit transitions from `proposal` to `execution`:

- [ ] **Proposal completeness** — All required sections present and non-empty
- [ ] **Risk assessment thoroughness** — Minimum 3 edge cases, 3 security risks, 3 performance concerns identified
- [ ] **Test strategy adequacy** — Test cases cover all identified edge cases and security risks
- [ ] **Scope containment** — No files outside trajectory scope, no dependencies without justification
- [ ] **Human approval recorded** — Approval log entry exists with timestamp and reviewer ID

### Post-Execution Verification (Verification Phase)

Before orbit transitions from `execution` to `delivery`:

- [ ] **Build success** — `npm run build` exits with code 0
- [ ] **Test pass rate** — 100% of generated tests pass
- [ ] **Coverage threshold** — Test coverage ≥ 80% for new files
- [ ] **Lint compliance** — Zero lint errors or warnings
- [ ] **Bundle size compliance** — Production bundle ≤ 500KB gzipped
- [ ] **Security scan** — Dependency audit shows zero high/critical vulnerabilities
- [ ] **Accessibility scan** — Automated a11y tests pass (keyboard navigation, screen reader)

### Drift Detection

Compare execution artifacts to approved proposal:

- [ ] **File list match** — Files created/modified match proposal implementation plan exactly
- [ ] **Dependency match** — `package.json` changes match proposal dependencies section
- [ ] **Pattern compliance** — Implementation follows patterns documented in context package
- [ ] **No undocumented deviations** — Any deviation from proposal has corresponding decision log entry

**Drift tolerance:** 0% — Tier 2 requires exact alignment between proposal and execution. Any deviation triggers re-orbit.

---

## Policy Evolution

This intent-specific policy is valid for **all orbits within intent T3-004**. 

### Policy Update Triggers

This policy will be updated if:

1. **First orbit completes successfully** — Assess whether work type "new repository UI subsystem" should be promoted to Tier 1 for future similar intents
2. **Security incident occurs** — Demote trust tier or add new approval gates
3. **Pattern emerges from orbit log** — Multiple re-orbits with same root cause suggests missing constraint or approval criteria
4. **Trajectory-level policy changes** — Repository Viewer trajectory trust tier policy supersedes this intent-specific policy

### Promotion Consideration

After successful completion of T3-004, evaluate for pattern extraction:

- If orbit passes on first attempt with zero drift and zero security findings → Consider creating "repository UI extension" pattern at Tier 1 for future intents
- If execution reveals novel security considerations → Update trajectory-level security checklist, keep work type at Tier 2
- If performance optimizations required multiple re-orbits → Document lessons learned, maintain Tier 2 for "large-scale virtualized UI" work type

---

## Authority

**Trajectory Lead Override:**  
Trajectory Lead may override this policy to:
- Temporarily promote to Tier 1 if orbit log data from related intents shows consistent success (≥ 95% pass rate over 10 orbits)
- Temporarily demote to Tier 3 if external risk factors emerge (new security threat model, regulatory requirement)

All overrides must be logged with justification and reviewed within 5 orbits.

**Emergency Demotion:**  
Any user with deploy authority may demote this intent to Tier 4 during a security incident. Demotion must be reviewed by Trajectory Lead within 24 hours.

---

**Policy Status:** Active  
**Next Review:** After orbit 1 completion or after any escalation event