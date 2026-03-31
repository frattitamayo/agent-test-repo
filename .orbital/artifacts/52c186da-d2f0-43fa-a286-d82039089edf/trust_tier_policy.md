# Trust Tier Policy — T3-002

**Intent:** T3-002 · Add GitHub file content endpoint  
**Project:** Prometheus V1  
**Trajectory:** Repository Viewer  
**Current Trust Tier:** Tier 2 (Supervised)  
**Orbit:** 1  
**Policy Effective Date:** 2024-12-19  

---

## 1. Current Tier — Tier 2 (Supervised)

### Tier Definition
**Supervised** execution requires AI to propose a complete implementation plan and wait for explicit human approval before any code execution or file modification begins.

### Why This Tier
This intent is classified as **Tier 2** because it:

- **Creates new API surface** — introduces a user-facing HTTP endpoint that expands the application's attack surface
- **Integrates external service** — interacts with GitHub API, introducing a new trust boundary
- **Handles variable data formats** — must correctly handle both text and binary files with appropriate encoding
- **Affects user experience** — endpoint failures or incorrect responses directly impact user-facing features

### Autonomy Level
The AI agent operates with **moderate autonomy**:
- ✅ Can author complete implementation proposals
- ✅ Can generate comprehensive test plans
- ✅ Can draft API documentation
- ❌ Cannot execute code changes until approved
- ❌ Cannot modify external configurations
- ❌ Cannot deploy to any environment

---

## 2. Approval Requirements

### Pre-Execution Approval Gate

| Gate | Requirement | Approver | Format |
|------|-------------|----------|--------|
| **Implementation Proposal** | Complete technical design including API contract, error handling, and edge cases | Trajectory Lead | Written approval in orbit log |
| **Security Review** | Verification that no credentials are exposed, rate limiting is considered, and input validation is comprehensive | System Architect or Security Engineer | Checkpoint sign-off |
| **Test Coverage Plan** | Unit tests for success/error paths, integration tests for GitHub API interaction | Trajectory Lead | Test plan approval |

### Approval Workflow
```
AI Proposal → Trajectory Lead Review → Security Checkpoint → Approval to Execute → Implementation → Verification
```

### Approval Authority

| Role | Authority | Constraints |
|------|-----------|-------------|
| **Trajectory Lead** | Primary approval authority for this intent | Must verify proposal against trajectory goals |
| **System Architect** | Security and integration pattern approval | Can block for architectural concerns |
| **Emergency Override** | Any deploy-authorized role during P0 incident | Requires post-incident review within 24 hours |

### Approval Documentation
Every approval MUST include:
- Approver name and role
- Timestamp of approval
- Specific items approved (proposal version, commit SHA if applicable)
- Any conditions or modifications required
- Documented in orbit log artifact

---

## 3. Autonomy Boundaries

### What the AI CAN Do (Without Additional Approval)

✅ **Proposal Authoring**
- Design complete API endpoint implementation
- Draft request/response schemas
- Plan error handling strategies
- Generate comprehensive test cases

✅ **Documentation Generation**
- Create API documentation
- Draft inline code comments
- Generate OpenAPI/Swagger specifications

✅ **Static Analysis**
- Perform code quality checks
- Run linting and formatting
- Identify potential security issues in proposals

✅ **Test Generation**
- Create unit test scaffolds
- Draft integration test scenarios
- Generate test fixtures and mocks

### What the AI CANNOT Do (Requires Explicit Approval)

❌ **Code Execution**
- Writing files to the repository
- Modifying existing code
- Creating new directories or files
- Running any code that changes system state

❌ **External Service Interaction**
- Making GitHub API calls (even read-only)
- Modifying webhook configurations
- Testing against production GitHub repositories

❌ **Configuration Changes**
- Modifying environment variables
- Changing API rate limits
- Altering authentication settings

❌ **Deployment Actions**
- Pushing commits
- Creating pull requests
- Deploying to any environment
- Modifying CI/CD pipelines

### Autonomy Boundaries by Work Type

| Work Type | AI Autonomy | Gate |
|-----------|-------------|------|
| API contract design | Propose freely | Trajectory Lead approval required |
| Implementation code | Propose freely | Trajectory Lead + Security approval |
| Unit tests | Propose freely | Trajectory Lead approval |
| Integration tests | Propose freely | Trajectory Lead approval |
| Documentation | Execute freely (post-approval) | Included in proposal approval |
| GitHub API calls | Cannot execute | Must use mock/stub in tests |

---

## 4. Escalation Criteria

### Escalate to Tier 3 (Collaborative) IF:

| Condition | Rationale | Action |
|-----------|-----------|--------|
| **Multiple re-orbits (>2)** | Indicates ambiguity in requirements or implementation approach | Human co-authors next orbit with AI |
| **Security concerns identified** | Security review flags architectural risks | System Architect joins collaborative design |
| **GitHub API rate limiting issues** | Integration complexity exceeds initial assumptions | Collaborative session to redesign approach |
| **Cross-domain impact discovered** | Endpoint affects authentication, authorization, or workspace boundaries | Collaborative design with affected domain owners |

### Escalate to Tier 4 (Human-Led) IF:

| Condition | Rationale | Action |
|-----------|-----------|--------|
| **Compliance implications** | File content may involve PII, GDPR, or regulatory data | Legal/compliance review required |
| **Architecture decision needed** | Fundamental choice between patterns (e.g., streaming vs. buffered) | System Architect leads decision |
| **GitHub Terms of Service concerns** | Usage patterns may violate GitHub API terms | Human review of integration approach |

### De-Escalate to Tier 1 (Informed) IF:

After **10 consecutive successful orbits** with:
- ≥ 95% pass rate
- ≤ 5% drift rate
- Zero security issues
- Zero re-orbits

Then this work type (read-only GitHub API endpoints) may be promoted to Tier 1 for future intents.

---

## 5. Audit Trail Requirements

### Mandatory Logging

Every orbit execution MUST log:

| Artifact | Content | Retention |
|----------|---------|-----------|
| **Orbit Log Entry** | Intent ID, orbit number, phase, status, timestamps | Permanent |
| **Proposal Artifact** | Complete proposal with AI reasoning | Permanent |
| **Approval Record** | Approver, timestamp, approval scope, conditions | Permanent |
| **Verification Results** | Pass/fail status, gate results, execution drift | Permanent |
| **Git Commits** | All code changes with orbit ID in commit message | Per repo policy |

### Required Orbit Log Fields

```yaml
orbit_log:
  orbit_id: "ORB-INT-T3-002-001"
  intent_id: "T3-002"
  trust_tier: 2
  phase: "verification"
  
  proposal:
    ai_model: "<model_version>"
    generated_at: "<timestamp>"
    proposal_hash: "<sha256>"
    
  approval:
    approved_by: "<name>"
    role: "Trajectory Lead"
    approved_at: "<timestamp>"
    approval_scope: "full_implementation"
    conditions: []
    
  execution:
    started_at: "<timestamp>"
    completed_at: "<timestamp>"
    drift_detected: false
    re_orbit_count: 0
    
  verification:
    automated_gates:
      - gate: "unit_tests"
        result: "pass"
      - gate: "lint"
        result: "pass"
      - gate: "security_scan"
        result: "pass"
    human_verification:
      verified_by: "<name>"
      verified_at: "<timestamp>"
      result: "pass"
```

### Drift Tracking

Any deviation from approved proposal MUST be logged:
- **What changed** from the approved proposal
- **Why the change occurred** (AI reasoning)
- **Whether re-approval was obtained**
- **Drift percentage** (changed lines / total lines)

If drift exceeds **15%**, execution MUST pause for re-approval.

### Security Audit Trail

For this Tier 2 intent, additionally log:
- All GitHub API interactions (endpoints called, response codes)
- Input validation results (file paths, repository names)
- Error handling invocations
- Rate limiting encounters
- Any authentication/authorization decisions

### Verification Evidence

Orbit log MUST include verification artifacts:
- Test execution results (pass/fail counts, coverage %)
- Static analysis reports
- Security scan results
- Manual verification sign-off

---

## Policy Version Control

**Policy ID:** TTP-T3-002-v1  
**Author:** System (generated for Intent T3-002)  
**Approved By:** Trajectory Lead  
**Supersedes:** N/A (initial policy)  
**Next Review:** After orbit 10 or first security incident  

### Evolution Conditions

This policy will be reviewed and potentially updated when:
1. 10 orbits complete for this intent or similar work type
2. A security incident traces to this endpoint
3. GitHub API integration patterns change
4. Cross-domain impact is discovered
5. Promotion/demotion triggers activate

---

## Summary

**Intent T3-002** operates at **Trust Tier 2 (Supervised)** because it introduces new API surface and external service integration. The AI proposes complete implementations but waits for explicit Trajectory Lead approval before execution. All work is logged, verified, and subject to security review. Escalation to Tier 3 occurs after 2+ re-orbits or discovery of security/compliance concerns. Promotion to Tier 1 is possible after 10 consecutive successful orbits with ≥95% pass rate.

The trust boundary is clear: **AI authors, human approves, system verifies, log records everything.**