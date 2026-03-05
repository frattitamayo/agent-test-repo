# Trust Tier Policy — Create Template Project

**Intent ID:** Create Template Project  
**Trust Tier:** Tier 1 (Informed)  
**Orbit:** 1  
**Project:** Fio Test Repo  
**Trajectory:** Testing GitHub Integration

---

## 1. Current Tier — Tier 1 (Informed)

### Tier Definition
**High Autonomy with Post-Execution Review**

The AI agent operates with high autonomy and executes work without waiting for human approval. The human reviews work after completion, and any modifications or feedback feed into future orbits.

### Why This Tier?
This intent qualifies for Tier 1 because:
- **Low-risk, observable work:** Creating a React template project is a well-established pattern with minimal blast radius
- **Reversible:** Project scaffolding can be easily modified or regenerated if issues arise
- **No sensitive flows:** Does not touch authentication, payment, PII, or security-critical systems
- **Proven patterns:** React project initialization follows documented, stable patterns (Create React App, Vite, etc.)

### What This Means
- AI proposes and executes the work autonomously
- Human is notified after completion
- No approval gate blocks execution
- Human reviews output and provides feedback for orbit refinement

---

## 2. Approval Requirements

### Pre-Execution
**None required.** The AI proceeds with execution once the intent is validated and the proposal is generated.

### Post-Execution
- **Trajectory Lead Review:** Required within **24 hours** of orbit completion
- **Review Scope:**
  - Verify project structure follows React best practices
  - Confirm dependencies are current and secure
  - Check that scaffolding is production-ready
  - Validate documentation is present and accurate

### Automated Gates
Must pass before orbit closes:
1. **Lint and Format:** Code passes `npm run lint` and formatting checks
2. **Build Success:** Project builds without errors (`npm run build`)
3. **Test Harness:** Basic test infrastructure is present and executable
4. **Dependency Audit:** No critical vulnerabilities in dependencies (`npm audit`)

---

## 3. Autonomy Boundaries

### What the AI CAN Do (No Human Approval)
- Initialize React project using standard tooling (CRA, Vite, Next.js, etc.)
- Install and configure common dependencies (React Router, testing libraries, etc.)
- Create standard directory structure (`src/`, `public/`, `components/`, etc.)
- Generate basic configuration files (`package.json`, `tsconfig.json`, `.eslintrc`, etc.)
- Add starter components and example code
- Write initial documentation (`README.md`, `CONTRIBUTING.md`)
- Configure development scripts (`start`, `build`, `test`)
- Set up `.gitignore` and version control structure

### What the AI CANNOT Do (Requires Escalation)
- Install dependencies with known security vulnerabilities
- Configure external services or API integrations (escalate to **Tier 2**)
- Set up authentication or user management (escalate to **Tier 2**)
- Modify existing production code or infrastructure (escalate to **Tier 3**)
- Make architecture decisions affecting other projects (escalate to **Tier 4**)

### Decision Authority
The AI has full authority to make technical choices within the React ecosystem:
- Framework selection (CRA vs. Vite vs. Next.js)
- TypeScript vs. JavaScript
- Testing library selection (Jest, Vitest, Testing Library)
- CSS approach (CSS Modules, Styled Components, Tailwind)

**Constraint:** Choices must follow project conventions if documented. If no conventions exist, AI documents its choices in the proposal.

---

## 4. Escalation Criteria

### Automatic Escalation to Tier 2 (Supervised)
Trigger escalation if the intent expands to include:
- Integration with external APIs or services
- Authentication or authorization implementation
- Database setup or data persistence
- Payment processing or sensitive user data handling
- Modification of existing production systems

### Automatic Escalation to Tier 3 (Collaborative)
Trigger escalation if:
- Work requires cross-domain coordination (backend + frontend)
- Architecture decisions affect multiple services or projects
- Infrastructure changes are required (deployment config, CDK, CI/CD)
- Work touches multiple repositories or deployment environments

### Escalation Process
1. AI detects escalation condition during proposal generation
2. AI pauses execution and generates escalation report
3. Trajectory Lead notified immediately
4. Intent re-scoped or split, or trust tier manually adjusted
5. Work resumes at appropriate tier with required approvals

### De-Escalation Not Permitted
Once escalated, the intent cannot be de-escalated mid-orbit. Complete the orbit at the higher tier, then evaluate tier adjustment for future orbits based on orbit log data.

---

## 5. Audit Trail Requirements

### Mandatory Log Entries

#### Proposal Phase
- Framework and tooling choices with rationale
- Dependency list with versions
- Directory structure plan
- Configuration decisions (TypeScript, linting, testing)

#### Execution Phase
- Commands executed (`npx create-react-app`, `npm install`, etc.)
- Files created with timestamps
- Build and test results
- Any errors encountered and resolution steps

#### Verification Phase
- Automated gate results (lint, build, audit)
- Drift detection: deviations from proposal
- Human review notes and feedback

### Orbit Log Schema
```yaml
orbit_id: "ORB-FTR-TGI-001-1"
intent_id: "create-template-project"
trust_tier: 1
status: "completed"
timestamps:
  started: "2024-01-15T10:00:00Z"
  completed: "2024-01-15T10:45:00Z"
  reviewed: "2024-01-15T14:30:00Z"
proposal:
  framework: "Vite + React"
  typescript: true
  dependencies: ["react", "react-dom", "react-router-dom"]
execution:
  commands_run: 12
  files_created: 47
  build_success: true
verification:
  lint: "pass"
  build: "pass"
  audit: "pass (0 vulnerabilities)"
  drift_detected: false
review:
  reviewer: "Trajectory Lead"
  approval: true
  feedback: "Clean scaffolding. Consider adding Prettier config."
metrics:
  cycle_time_minutes: 45
  re_orbit_count: 0
```

### Retention
- All orbit logs retained for **minimum 90 days**
- Logs queryable by intent, tier, project, and trajectory
- Logs feed into trust tier policy evolution (periodic review every 20 orbits)

---

## Policy Enforcement

This policy is **enforced by tooling**. The AI agent reads this policy before every orbit and operates within its constraints. Manual overrides require Trajectory Lead authority and are logged in the orbit record.

**Effective Date:** 2024-01-15  
**Review Cycle:** Every 20 orbits or monthly (whichever comes first)  
**Policy Owner:** Trajectory Lead — Testing GitHub Integration

---

## Summary

**Tier 1 (Informed)** grants high autonomy for this low-risk, well-established work pattern. The AI executes without approval, humans review post-execution, and feedback refines future orbits. Escalation triggers are clear, audit trails are comprehensive, and governance is data-driven, not opinion-driven.