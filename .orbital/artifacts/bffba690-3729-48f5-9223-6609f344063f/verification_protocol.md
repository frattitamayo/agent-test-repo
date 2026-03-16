# Verification Protocol: Implement CI/CD Pipeline with Automated Testing and Deployment

## Automated Gates

### Gate 1: Workflow File Syntax Validation

**Objective:** Verify GitHub Actions workflow configuration is syntactically valid and can be parsed by GitHub's workflow engine.

**Execution:**
```bash
# Using GitHub CLI (requires gh CLI installed and authenticated)
gh workflow view ci-cd.yml

# Expected output: Workflow details displayed without syntax errors
# Exit code: 0
```

**Pass Criteria:**
- Command exits with code 0
- No YAML syntax errors reported
- Workflow structure successfully parsed

**Traceability:** Maps to Intent acceptance criterion "Pipeline configuration file committed to repository" — ensures configuration is valid before attempting execution.

---

### Gate 2: Pipeline Trigger Verification

**Objective:** Confirm pipeline automatically triggers on code push events per Intent requirement "Pipeline executes automatically on every push to repository."

**Test Case 2.1: Feature Branch Push Triggers Build and Test**

**Execution:**
```bash
# Create test feature branch
git checkout -b test/pipeline-trigger-verification
echo "# Test commit" >> test-file.md
git add test-file.md
git commit -m "Test: Verify pipeline trigger"
git push origin test/pipeline-trigger-verification

# Query GitHub Actions API for workflow run
gh run list --workflow=ci-cd.yml --branch=test/pipeline-trigger-verification --limit=1 --json status,conclusion
```

**Expected Output:**
```json
{
  "status": "completed",
  "conclusion": "success"
}
```

**Pass Criteria:**
- Workflow run appears within 30 seconds of push
- Build job executes
- Test job executes
- Deploy job does NOT execute (feature branch)
- Overall workflow status: success

**Traceability:** Maps to Intent acceptance criterion "Pipeline executes automatically on every push" and "Failed tests block further pipeline progression."

---

**Test Case 2.2: Pull Request Triggers Pipeline**

**Execution:**
```bash
# Create pull request from test branch
gh pr create --title "Test PR" --body "Pipeline verification" --base main --head test/pipeline-trigger-verification

# Verify workflow triggers
gh run list --workflow=ci-cd.yml --event=pull_request --limit=1 --json status,conclusion
```

**Expected Output:**
```json
{
  "status": "completed",
  "conclusion": "success"
}
```

**Pass Criteria:**
- Workflow triggered by pull_request event
- Status checks visible in PR interface
- Build and test jobs execute
- No deployment jobs execute

**Traceability:** Maps to Intent branch strategy where "Pull requests" trigger "Build + test only."

---

### Gate 3: Test Suite Integration

**Objective:** Verify test suite executes in CI environment and reports results correctly per Intent "Test suite runs in CI environment and reports pass/fail status."

**Test Case 3.1: Tests Execute Successfully**

**Execution:**
```bash
# Trigger workflow and capture test job logs
gh run view --log --job=test

# Parse for test execution confirmation
grep "npm test" workflow-logs.txt
grep "Tests: [0-9]* passed" workflow-logs.txt
```

**Expected Output:**
```
> npm test
Tests: 5 passed, 5 total
Time: 2.3s
```

**Pass Criteria:**
- `npm test` command executes
- Test summary shows passed count
- Exit code 0 for test job
- No unhandled exceptions in logs

**Traceability:** Maps to Intent acceptance criterion "Test suite runs in CI environment and reports pass/fail status."

---

**Test Case 3.2: Test Failures Block Pipeline**

**Execution:**
```bash
# Introduce failing test temporarily
cat >> test/api/properties/search.test.js << 'EOF'
it('deliberate failure for pipeline verification', () => {
  throw new Error('Expected test failure');
});
EOF

git add test/api/properties/search.test.js
git commit -m "Test: Add failing test for verification"
git push origin test/pipeline-trigger-verification

# Query workflow outcome
gh run list --workflow=ci-cd.yml --branch=test/pipeline-trigger-verification --limit=1 --json conclusion,status
```

**Expected Output:**
```json
{
  "conclusion": "failure",
  "status": "completed"
}
```

**Pass Criteria:**
- Test job fails with exit code 1
- Workflow conclusion: failure
- Deployment job does NOT execute
- Error message clearly indicates test failure

**Traceability:** Maps to Intent acceptance criterion "Failed tests block further pipeline progression with clear error messages."

---

### Gate 4: Coverage Reporting

**Objective:** Verify test coverage is calculated and reported per target acceptance criterion "Runs tests + reports coverage."

**Execution:**
```bash
# Check for coverage artifact generation
gh run view --job=test --log | grep -A 5 "Generate coverage report"

# Download coverage artifact
gh run download --name coverage-report

# Verify coverage report exists
test -f coverage/coverage-summary.json && echo "PASS: Coverage report generated" || echo "FAIL: Coverage report missing"
```

**Expected Output:**
```
PASS: Coverage report generated
```

**Pass Criteria:**
- Coverage report generated during test job
- `coverage/coverage-summary.json` exists in artifacts
- Coverage percentage calculated and logged
- Report uploaded to GitHub Actions artifacts with 30-day retention

**Traceability:** Maps to Intent target acceptance criterion "Runs tests + reports coverage."

---

### Gate 5: Coverage Quality Gate (Target Acceptance)

**Objective:** Verify coverage threshold enforcement per stretch goal "Tests + coverage + quality gates (minimum coverage threshold)."

**Execution:**
```bash
# Review coverage gate step in workflow logs
gh run view --log --job=test | grep -A 10 "Check coverage thresholds"

# Verify threshold check logic
cat .github/workflows/ci-cd.yml | grep -A 15 "Check coverage thresholds"
```

**Expected Behavior:**
```yaml
# Workflow includes coverage threshold check
- name: Check coverage thresholds
  run: |
    COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
    if (( $(echo "$COVERAGE < 60" | bc -l) )); then
      exit 1
    fi
```

**Pass Criteria:**
- Coverage threshold check step exists in workflow
- Threshold set to minimum 60% (from test suite orbit)
- Job fails if coverage below threshold
- Clear error message indicates coverage gap

**Traceability:** Maps to Intent stretch acceptance criterion "Tests + coverage + quality gates (minimum coverage threshold)."

---

### Gate 6: Dependency Caching

**Objective:** Verify dependency caching configured to meet performance target "Results within 5 minutes."

**Execution:**
```bash
# Check workflow for cache configuration
grep -A 5 "cache:" .github/workflows/ci-cd.yml

# Compare build times between cache hit and miss
gh run list --workflow=ci-cd.yml --limit=2 --json startedAt,completedAt,conclusion
```

**Expected Configuration:**
```yaml
- uses: actions/setup-node@v4
  with:
    node-version: ${{ env.NODE_VERSION }}
    cache: 'npm'  # Cache enabled
```

**Pass Criteria:**
- Cache configuration present in workflow
- Cache key based on `package-lock.json` hash
- Second workflow run shows faster dependency installation (cache hit)
- Build time reduced by 30-60 seconds with cache

**Traceability:** Maps to Intent target acceptance "Results within 5 minutes" — caching is critical optimization.

---

### Gate 7: Execution Time Validation

**Objective:** Verify pipeline completes within target time constraint "Results within 5 minutes."

**Execution:**
```bash
# Measure workflow execution time
gh run view --json startedAt,completedAt | jq -r '
  (.startedAt | fromdateiso8601) as $start |
  (.completedAt | fromdateiso8601) as $end |
  "Duration: (($end - $start) / 60) minutes"
'
```

**Expected Output:**
```
Duration: 3.2 minutes
```

**Pass Criteria:**
- Total workflow execution time < 5 minutes (target)
- Build job: < 2 minutes
- Test job: < 3 minutes
- Deployment job: Not measured (template only)

**Acceptance Spectrum:**
- Minimum: < 10 minutes
- Target: < 5 minutes ✓
- Stretch: < 2 minutes with parallel jobs

**Traceability:** Maps directly to Intent acceptance boundary "Feedback Speed" target criterion.

---

### Gate 8: Deployment Stage Configuration

**Objective:** Verify deployment stage exists with proper conditional logic per target "Build + Test + Deploy to staging."

**Execution:**
```bash
# Verify deployment job exists
yq eval '.jobs | has("deploy-staging")' .github/workflows/ci-cd.yml

# Check conditional execution
yq eval '.jobs.deploy-staging.if' .github/workflows/ci-cd.yml
```

**Expected Output:**
```yaml
true  # Job exists

"github.ref == 'refs/heads/main' && github.event_name == 'push'"  # Conditional
```

**Pass Criteria:**
- `deploy-staging` job defined in workflow
- Job depends on test job: `needs: test`
- Conditional: only executes on main branch pushes
- Does NOT execute on pull requests or feature branches
- Template deployment step present with instructional error

**Traceability:** Maps to Intent target acceptance "Build + Test + Deploy to staging."

---

### Gate 9: Secret Reference Validation

**Objective:** Verify all secret references in workflow are documented per security constraint "all sensitive values must use CI/CD platform's secret management."

**Execution:**
```bash
# Extract all secret references from workflow
grep -oP '${{ secrets.K[A-Z_]+' .github/workflows/ci-cd.yml | sort -u > workflow-secrets.txt

# Compare against documented secrets
grep "^| `[A-Z_]*`" docs/deployment/secrets.md | cut -d'`' -f2 | sort -u > documented-secrets.txt

# Verify all workflow secrets are documented
comm -23 workflow-secrets.txt documented-secrets.txt
```

**Expected Output:**
```
(empty - no undocumented secrets)
```

**Pass Criteria:**
- All secrets referenced in workflow appear in `docs/deployment/secrets.md`
- No hardcoded credentials in workflow file
- Secret names follow naming convention (UPPERCASE_WITH_UNDERSCORES)
- Each secret documented with description and example

**Traceability:** Maps to Intent security constraint "No secrets or credentials committed to repository; all sensitive values must use CI/CD platform's secret management."

---

### Gate 10: Documentation Completeness

**Objective:** Verify comprehensive documentation exists per target "Setup guide in repository."

**Execution:**
```bash
# Verify all required documentation files exist
test -f docs/deployment/README.md && echo "✓ Setup guide" || echo "✗ Setup guide missing"
test -f docs/deployment/secrets.md && echo "✓ Secrets template" || echo "✗ Secrets missing"
test -f docs/deployment/troubleshooting.md && echo "✓ Troubleshooting" || echo "✗ Troubleshooting missing"

# Verify README contains CI/CD section
grep -q "## CI/CD Pipeline" README.md && echo "✓ README updated" || echo "✗ README not updated"

# Verify badge syntax present
grep -q "![CI/CD Pipeline]" README.md && echo "✓ Status badge" || echo "✗ Badge missing"
```

**Expected Output:**
```
✓ Setup guide
✓ Secrets template
✓ Troubleshooting
✓ README updated
✓ Status badge
```

**Pass Criteria:**
- All documentation files exist in `docs/deployment/`
- Setup guide includes secret configuration instructions
- Troubleshooting guide includes at least 5 common issues
- Main README updated with CI/CD section
- Status badge syntax present (URL may be placeholder)

**Acceptance Spectrum:**
- Minimum: Pipeline configuration file with comments ✓
- Target: Setup guide in repository ✓
- Stretch: Troubleshooting guide and common issues documented ✓

**Traceability:** Maps to Intent acceptance boundary "Documentation Completeness."

---

### Gate 11: Backward Compatibility Verification

**Objective:** Verify existing workflows remain functional per constraint "Existing codebase and test suite must continue functioning without modification."

**Execution:**
```bash
# Verify API still runs locally
timeout 5 node backend/api/properties/search.js &
PID=$!
sleep 2
curl -f http://localhost:3000/api/properties/search
CURL_EXIT=$?
kill $PID

# Verify tests still run locally
npm test
TEST_EXIT=$?

# Check exit codes
test $CURL_EXIT -eq 0 && test $TEST_EXIT -eq 0 && echo "PASS: Backward compatibility maintained" || echo "FAIL: Local workflows broken"
```

**Expected Output:**
```
PASS: Backward compatibility maintained
```

**Pass Criteria:**
- `node backend/api/properties/search.js` starts successfully
- API responds to HTTP requests
- `npm test` executes without errors
- No modifications to `backend/api/properties/search.js`
- No modifications to test files

**Traceability:** Maps to Intent constraint "Existing Workflow Preservation: Developers must retain ability to run API locally via `node backend/api/properties/search.js` and tests via `npm test`."

---

### Gate 12: No Credentials in Repository

**Objective:** Verify no secrets committed to repository per security constraint.

**Execution:**
```bash
# Scan for common credential patterns
git grep -E "(password|secret|api_key|private_key|token)" -- '*.yml' '*.yaml' '*.sh' '*.js' '*.json' | grep -v "secrets." | grep -v "# Example" | grep -v "Secret Name"

# Check for .env files in git history
git log --all --full-history -- "**/.env"

# Verify .gitignore includes .env
grep ".env" .gitignore
```

**Expected Output:**
```
(no matches - credentials scan clean)
(no commits - .env never committed)
.env  # Present in .gitignore
```

**Pass Criteria:**
- No credential patterns found in committed files
- No `.env` files in git history
- `.gitignore` includes `.env` pattern
- All secret references use `${{ secrets.* }}` syntax
- Documentation explicitly warns against committing secrets

**Traceability:** Maps to Intent security constraint "No secrets or credentials committed to repository."

## Human Verification Points

### HV1: Deployment Target Customization Required

**What to Verify:** The deployment stage contains a template that explicitly fails until customized for actual infrastructure.

**Steps:**
1. Open `.github/workflows/ci-cd.yml`
2. Locate `deploy-staging` job, `Deploy to staging` step
3. Verify step contains:
   ```yaml
   run: |
     echo "⚠️  DEPLOYMENT TEMPLATE - CUSTOMIZE FOR YOUR PLATFORM"
     exit 1  # Fail until customized
   ```
4. Verify inline comments document customization requirements
5. Confirm deployment templates exist in `scripts/` directory

**Pass Criteria:**
- Deployment step fails with clear instructional message
- Comments document required secrets
- Platform-specific examples provided
- Template prevents accidental deployment to unconfigured target

**Rationale:** Tier 3 gated orbit requires human decision on deployment target before automation can proceed. Template ensures this decision cannot be skipped.

**Traceability:** Maps to Intent dependency "Deployment Target Access: Requires credentials and access to target deployment environment."

---

### HV2: Security Review of Secret Management

**What to Verify:** All secret handling follows security best practices.

**Steps:**
1. Review workflow file for secret references
2. Verify no `echo ${{ secrets.* }}` statements that would log secrets
3. Confirm secrets only used in `env:` blocks, never in `run:` command strings
4. Review deployment scripts for secret handling
5. Verify documentation warns against exposing secrets

**Checklist:**
- [ ] Secrets referenced via `${{ secrets.NAME }}` syntax only
- [ ] No secrets echoed or printed in logs
- [ ] Secrets passed as environment variables, not command arguments
- [ ] Deployment verification doesn't log full URLs containing tokens
- [ ] Documentation includes "⚠️ Security Note" warnings
- [ ] Troubleshooting guide explicitly warns against echoing secrets

**Pass Criteria:** All checklist items verified; no security anti-patterns found.

**Rationale:** Tier 3 gated orbit with security surface requires human validation of credential handling before production use.

**Traceability:** Maps to Intent security constraint "deployment keys must have minimum required permissions" and "No secrets or credentials committed to repository."

---

### HV3: Test Suite Reliability Assessment

**What to Verify:** Test suite provides reliable quality gate without flakiness.

**Steps:**
1. Execute pipeline 5 times with identical code
2. Verify all 5 runs pass with consistent results
3. Review test execution times across runs
4. Check for intermittent failures or timeouts
5. Confirm test coverage percentages consistent

**Data Collection:**
```bash
for i in {1..5}; do
  gh workflow run ci-cd.yml
  sleep 120  # Wait for completion
  gh run list --workflow=ci-cd.yml --limit=1 --json conclusion,databaseId
done
```

**Pass Criteria:**
- All 5 runs succeed with identical conclusions
- Test execution time variance < 10%
- No timeout failures
- No tests marked as "flaky" or "skip"
- Coverage percentage variance < 1%

**Fail Action:** If any run fails inconsistently, identify and fix flaky tests before approving pipeline activation.

**Rationale:** Automated deployment gates require reliable tests. Flaky tests erode trust and encourage bypassing quality gates.

**Traceability:** Maps to Risk Assessment "Test suite flakiness causes false failures" and Intent acceptance "Test suite runs in CI environment and reports pass/fail status."

---

### HV4: Documentation Clarity and Completeness

**What to Verify:** New contributors can understand and modify pipeline without external assistance per Intent "New contributors can understand and modify pipeline without external assistance."

**Steps:**
1. Identify team member unfamiliar with CI/CD implementation
2. Provide only repository access (no verbal explanation)
3. Ask them to:
   - Locate pipeline configuration
   - Identify where tests execute
   - Find secret configuration instructions
   - Locate troubleshooting guide
   - Understand deployment process
4. Time how long it takes to answer these questions
5. Record any confusion points or missing information

**Pass Criteria:**
- All questions answered correctly
- Total time < 15 minutes
- No external documentation required
- Reviewer confidence they could modify workflow
- Zero confusion about deployment customization requirements

**Feedback Loop:** Document any unclear sections identified and improve documentation before final approval.

**Traceability:** Maps directly to Intent acceptance criterion "New contributors can understand and modify pipeline without external assistance."

---

### HV5: Branch Strategy Verification

**What to Verify:** Pipeline behaves correctly for different branch patterns per Context Package branch strategy.

**Test Scenarios:**

| Branch Pattern | Expected Behavior | Verification Method |
|---------------|-------------------|---------------------|
| `main` push | Build → Test → Deploy Staging | Merge test PR, verify staging deploy triggers |
| `develop` push | Build → Test → Deploy Staging | Push to develop, verify deploy triggers |
| `feature/xyz` push | Build → Test only | Push to feature branch, verify no deploy |
| PR to `main` | Build → Test only | Open PR, verify status checks but no deploy |

**Steps:**
1. Test each branch pattern scenario
2. Review workflow run logs for each
3. Verify deployment job presence/absence matches expectations
4. Confirm status checks visible in PR interface

**Pass Criteria:**
- All scenarios behave as documented in Context Package
- No accidental deployments from feature branches
- Main branch deployments require test passage
- PR status checks block merging on test failure

**Traceability:** Maps to Context Package architecture "Branch Strategy Implications" and Intent "upon success, deploys to appropriate environments based on branch strategy."

---

### HV6: Deployment Verification Effectiveness

**What to Verify:** Post-deployment verification catches broken deployments.

**Steps:**
1. Review deployment verification step in workflow
2. Verify smoke test actually exercises API functionality
3. Confirm curl uses `-f` flag to fail on HTTP errors
4. Test verification with intentionally broken deployment (in staging)
5. Verify workflow fails when deployment is non-functional

**Test Case:**
```bash
# Simulate broken deployment by pointing STAGING_URL to invalid endpoint
# Set secret temporarily: STAGING_URL=http://localhost:9999/nonexistent
# Trigger workflow
# Expected: Deployment verification step fails
# Expected: Clear error message about connection failure
```

**Pass Criteria:**
- Verification step actually executes API request
- HTTP error codes cause verification failure
- Connection errors cause verification failure
- Error messages indicate specific failure reason
- Broken deployments do NOT report success

**Rationale:** Deployment success without verification creates false confidence. Verification must meaningfully validate functionality.

**Traceability:** Maps to Risk Assessment "Deployment succeeds but application non-functional" and mitigation "Deployment verification step includes smoke test hitting actual endpoint."

---

### HV7: Rollback Procedure Validation (Stretch Goal)

**What to Verify:** Production rollback capability functions correctly if implemented.

**Prerequisites:** Only verify if Phase 4 (production deployment) implemented and approved.

**Steps:**
1. Create mock "bad" deployment by deploying code with known issue to staging
2. Identify previous release tag
3. Execute rollback workflow via manual trigger
4. Verify previous version deployed successfully
5. Confirm API returns expected behavior from previous version

**Test Execution:**
```bash
# Trigger rollback workflow
gh workflow run ci-cd.yml --ref main -f tag=release-20240101-120000

# Verify rollback completed
gh run list --workflow=ci-cd.yml --limit=1 --json conclusion

# Verify correct version deployed
curl https://staging-url/api/properties/search | jq '.version'  # Should match rollback target
```

**Pass Criteria:**
- Rollback workflow triggers successfully
- Previous version deploys without errors
- Verification step confirms functionality
- Total rollback time < 5 minutes
- Documentation accurately describes procedure

**Fail Action:** If rollback fails, document gap and create follow-up task for rollback capability improvement.

**Traceability:** Maps to Intent stretch acceptance "Automatic deploy with rollback capability" and Risk Assessment "Rollback procedure not tested."

---

### HV8: Infrastructure Prerequisite Confirmation

**What to Verify:** All external dependencies documented and available before pipeline activation.

**Checklist:**
- [ ] Staging environment exists and accessible
- [ ] Database accessible from staging environment
- [ ] Deployment credentials created with minimum permissions
- [ ] Secrets added to GitHub repository settings
- [ ] Environment protection rules configured for production
- [ ] Approved reviewers designated for production deploys
- [ ] Manual deployment tested once before automation

**Steps:**
1. Review deployment target specification from human reviewer
2. Verify each checklist item with infrastructure team
3. Test manual deployment to staging environment
4. Confirm database connectivity
5. Verify secrets correctly configured in GitHub

**Pass Criteria:** All checklist items confirmed before approving pipeline activation.

**Fail Action:** Document missing prerequisites; delay pipeline activation until resolved.

**Traceability:** Maps to Intent dependencies "Deployment Target Access: Requires credentials and access to target deployment environment" and "Database already exists and accessible from target environment."

## Intent Traceability

### Mapping: Automated Gates to Intent Acceptance Criteria

| Gate | Intent Acceptance Criterion | Tier | Verification Type |
|------|---------------------------|------|-------------------|
| Gate 1 | Pipeline configuration file committed | Minimum | Syntax validation |
| Gate 2 | Pipeline executes automatically on every push | Done Criteria | Trigger test |
| Gate 3 | Test suite runs in CI environment and reports pass/fail | Done Criteria | Execution verification |
| Gate 3.2 | Failed tests block further pipeline progression | Done Criteria | Failure path test |
| Gate 4 | Runs tests + reports coverage | Target | Artifact verification |
| Gate 5 | Tests + coverage + quality gates | Stretch | Threshold enforcement |
| Gate 6 | Results within 5 minutes (caching optimization) | Target | Performance measurement |
| Gate 7 | Results within 5 minutes | Target | Timing validation |
| Gate 8 | Build + Test + Deploy to staging | Target | Stage configuration |
| Gate 9 | No secrets committed to repository | Security Constraint | Secret scan |
| Gate 10 | Setup guide in repository | Target | Documentation check |
| Gate 11 | Existing workflow preservation | Backward Compatibility Constraint | Local execution test |
| Gate 12 | All sensitive values use secret management | Security Constraint | Pattern scan |

### Mapping: Human Verification Points to Intent Requirements

| HV Point | Intent Requirement | Tier | Why Human Required |
|----------|-------------------|------|-------------------|
| HV1 | Deployment target support for Node.js hosting | Constraint | Infrastructure decision |
| HV2 | Deployment keys minimum required permissions | Security Constraint | Security architecture judgment |
| HV3 | Test suite provides reliable quality gate | Dependency | Reliability assessment over time |
| HV4 | New contributors can understand pipeline | Done Criteria | Comprehension assessment |
| HV5 | Deploys to appropriate environments based on branch | Desired Outcome | Behavioral correctness |
| HV6 | Deployment verification catches failures | Risk Mitigation | Effectiveness judgment |
| HV7 | Automatic deploy with rollback capability | Stretch | Recovery procedure validation |
| HV8 | Deployment target access and credentials | Dependency | External system coordination |

### Orphan Check: Verification Coverage Audit

**All Intent Requirements Covered:**
- ✓ Pipeline executes automatically (Gate 2, HV5)
- ✓ Test suite runs and reports (Gate 3, Gate 4)
- ✓ Failed tests block progression (Gate 3.2)
- ✓ At least one deployment target configured (HV1, HV8)
- ✓ Configuration documented in README (Gate 10, HV4)
- ✓ New contributors can understand (HV4)
- ✓ Feedback within time constraints (Gate 6, Gate 7)
- ✓ No secrets committed (Gate 9, Gate 12, HV2)
- ✓ Existing workflows preserved (Gate 11)

**No Orphan Checks:** Every verification criterion traces back to either an Intent acceptance boundary, constraint, or risk mitigation requirement.

## Escape Criteria

### Escape Condition 1: Test Suite Not Available

**Trigger:** Phase 0 verification discovers no test suite exists or `npm test` fails.

**Severity:** BLOCKING — Cannot proceed with orbit.

**Detection:**
```bash
# In Phase 0
npm test
if [ $? -ne 0 ]; then
  echo "ESCAPE CONDITION: Test suite not functional"
  exit 1
fi
```

**Resolution Path:**
1. Abort current orbit immediately
2. Create blocking dependency on test suite orbit completion
3. Document in orbit log: "Cannot implement CI/CD without functional test suite"
4. Schedule test suite orbit before retrying CI/CD orbit

**Rollback:** None required (no changes committed yet).

**Escalation:** Alert project manager that test suite dependency not satisfied.

**Traceability:** Maps to Intent dependency "Test Suite Availability: Requires completed automated test suite from prior testing orbit."

---

### Escape Condition 2: Pipeline Execution Time Exceeds 10 Minutes (Minimum Not Met)

**Trigger:** Gate 7 validation shows workflow exceeds 10 minute minimum acceptance threshold.

**Severity:** HIGH — Minimum acceptance criteria not met.

**Detection:**
```bash
# After Gate 7
DURATION=$(gh run view --json startedAt,completedAt | jq -r '
  (.completedAt | fromdateiso8601) - (.startedAt | fromdateiso8601)
')

if [ $DURATION -gt 600 ]; then  # 600 seconds = 10 minutes
  echo "ESCAPE CONDITION: Pipeline exceeds 10 minute minimum"
fi
```

**Resolution Path:**

**Option A: Performance Optimization Re-orbit**
1. Identify slowest job in pipeline
2. Implement additional optimizations:
   - Parallel test execution
   - More aggressive caching
   - Test subset for PR checks
3. Re-run Gate 7 validation
4. Proceed if under threshold

**Option B: Acceptance Criteria Negotiation**
1. Document current performance metrics
2. Present to human reviewer with justification
3. Request minimum criteria adjustment if optimizations exhausted
4. Requires explicit human approval to proceed

**Rollback:** Revert to Phase 1, implement performance optimizations, re-execute Phases 2-6.

**Escalation:** If Option A fails after 2 attempts, escalate to Option B with human reviewer.

**Traceability:** Maps to Intent acceptance boundary "Feedback Speed" minimum 10 minutes.

---

### Escape Condition 3: Test Flakiness Detected (HV3 Fails)

**Trigger:** Human Verification Point 3 discovers inconsistent test results across 5 runs.

**Severity:** MEDIUM — Quality gate reliability compromised.

**Detection:** Any test failure in 5 consecutive runs with identical code.

**Resolution Path:**
1. Halt pipeline activation (do not deploy)
2. Identify flaky test(s) from failure logs
3. Create high-priority issue for test stability
4. Options:
   - **Fix flaky tests** (preferred): Stabilize tests before pipeline activation
   - **Temporarily skip flaky tests**: Mark with `.skip()` and document
   - **Add retry logic**: Implement test retry with clear warnings

**Recommended Approach:**
```javascript
// In test file - temporary mitigation only
it.skip('flaky test name', () => {
  // Test code
});
// TODO: Fix flakiness before production deployment
```

**Rollback:** Pipeline remains in draft state; no rollback needed (not activated).

**Escalation:** If flakiness not resolved in 2 days, escalate to team lead for priority adjustment.

**Re-orbit Condition:** Re-run HV3 after test fixes; must achieve 5/5 success rate before proceeding.

**Traceability:** Maps to Risk Assessment "Test suite flakiness causes false failures" and mitigation strategy.

---

### Escape Condition 4: Security Scan Detects Exposed Credentials (Gate 12 Fails)

**Trigger:** Gate 12 discovers credentials committed to repository.

**Severity:** CRITICAL — Security breach, immediate remediation required.

**Detection:** Gate 12 pattern scan returns matches.

**Resolution Path:**
1. **STOP all work immediately**
2. Identify exposed credential(s)
3. Execute credential rotation:
   ```bash
   # Revoke exposed credential immediately
   # Generate new credential
   # Update GitHub secrets
   # Verify old credential no longer works
   ```
4. Remove credential from git history:
   ```bash
   git filter-branch --force --index-filter 
     "git rm --cached --ignore-unmatch path/to/file" 
     --prune-empty --tag-name-filter cat -- --all
   
   git push origin --force --all
   git push origin --force --tags
   ```
5. Notify security team of exposure
6. Document incident and prevention measures

**Rollback:** Full git history rewrite required to remove exposed credentials.

**Escalation:** Immediate notification to security team and project lead.

**Re-orbit Condition:** Can only proceed after:
- Credentials rotated
- Git history cleaned
- Security team approval
- Additional secret scanning measures implemented

**Traceability:** Maps to Intent security constraint "No secrets or credentials committed to repository."

---

### Escape Condition 5: Deployment Target Not Specified (HV1 Fails)

**Trigger:** Human reviewer completes review without specifying deployment target or customizing deployment step.

**Severity:** LOW — Expected for Tier 3 gated orbit.

**Detection:** Deployment step still contains template failure message after human review.

**Resolution Path:**
1. This is **EXPECTED** behavior for Tier 3 gated orbit
2. Orbit deliverable is pipeline infrastructure, not activated deployment
3. Document in completion summary:
   - "Pipeline infrastructure complete"
   - "Deployment requires human customization per docs/deployment/README.md"
   - "Minimum acceptance criteria met"
   - "Deployment activation pending infrastructure decisions"

**Rollback:** Not applicable — this is not a failure condition.

**Next Steps:**
1. Human reviewer specifies deployment target
2. Customize deployment step per docs/deployment/README.md
3. Configure GitHub secrets
4. Test deployment manually once
5. Activate automated deployment

**Traceability:** Maps to Intent Trust Tier 3 requirement "Human review and explicit approval gates essential before automated production deployment."

---

### Escape Condition 6: Coverage Below 60% Minimum (Gate 5 Fails)

**Trigger:** Gate 5 detects test coverage below 60% minimum threshold from test suite orbit.

**Severity:** MEDIUM — Blocks deployment activation but pipeline structure complete.

**Detection:**
```bash
COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
if (( $(echo "$COVERAGE < 60" | bc -l) )); then
  echo "ESCAPE CONDITION: Coverage $COVERAGE% below 60% minimum"
fi
```

**Resolution Path:**

**Option A: Improve Test Coverage (Preferred)**
1. Identify uncovered code paths from coverage report
2. Add tests to reach 60% minimum
3. Re-run Gate 5
4. Proceed if threshold met

**Option B: Adjust Quality Gate**
1. Review acceptance boundaries with human reviewer
2. If current coverage represents reasonable testing for codebase maturity, request threshold adjustment
3. Requires explicit human approval
4. Document rationale for adjustment

**Rollback:** Pipeline remains functional; quality gate simply stricter than current coverage.

**Escalation:** If Option A blocked (time constraints, test complexity), escalate to Option B.

**Re-orbit Condition:** Not required — pipeline functional at minimum acceptance. Coverage improvement can occur in parallel.

**Traceability:** Maps to Intent target acceptance "80% code coverage including error paths" and minimum "60% code coverage of API handlers."

---

### Escape Condition 7: Backward Compatibility Broken (Gate 11 Fails)

**Trigger:** Gate 11 discovers local API or test execution no longer functions.

**Severity:** CRITICAL — Violates core constraint.

**Detection:**
```bash
# Local API broken
node backend/api/properties/search.js &
sleep 2
curl -f http://localhost:3000/api/properties/search
if [ $? -ne 0 ]; then
  echo "ESCAPE CONDITION: Local API execution broken"
fi

# Local tests broken
npm test
if [ $? -ne 0 ]; then
  echo "ESCAPE CONDITION: Local test execution broken"
fi
```

**Resolution Path:**
1. **STOP implementation immediately**
2. Identify what change broke local execution
3. Revert offending change
4. Review Intent constraint: "Developers must retain ability to run API locally"
5. Redesign approach to avoid modifying application code
6. Re-implement with backward compatibility preserved
7. Re-run Gate 11

**Rollback:** Revert all changes to application code and test files; keep only CI/CD infrastructure changes.

**Escalation:** If backward compatibility cannot be maintained, escalate to human reviewer for scope clarification.

**Re-orbit Condition:** Must pass Gate 11 before proceeding. No exceptions — this is a hard constraint.

**Traceability:** Maps to Intent constraint "Backward Compatibility: Existing codebase and test suite must continue functioning without modification."

---

### General Escalation Triggers

**Escalate to Human Reviewer If:**
1. Any CRITICAL severity escape condition occurs
2. Two escape conditions trigger in same orbit execution
3. Re-orbit attempts exceed 2 iterations
4. Estimated completion time exceeds 12 hours (1.5x original estimate)
5. Scope clarification needed to resolve escape condition

**Escalation Protocol:**
1. Document current state and blocker in orbit log
2. Provide specific question or decision needed
3. Include attempted solutions and why they failed
4. Recommend path forward with tradeoff analysis
5. Wait for explicit human decision before proceeding

**Abort Conditions (Do Not Proceed):**
- Security breach detected (Escape Condition 4)
- Core dependency missing (Escape Condition 1)
- Backward compatibility broken and cannot be restored (Escape Condition 7)
- Human reviewer explicitly rejects proposal

**Success Conditions (Orbit Complete):**
- All automated gates pass (Gates 1-12)
- All human verification points pass (HV1-HV8) OR explicitly deferred with documentation
- No active escape conditions
- Deliverables committed to repository
- Documentation complete and validated
- Human reviewer provides explicit approval for Tier 3 gated orbit