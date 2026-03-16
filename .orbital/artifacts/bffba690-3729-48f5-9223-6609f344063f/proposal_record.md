# Proposal Record: Implement Automated Testing Suite for Property Search API

## Interpreted Intent

This orbit establishes a production-ready automated test suite for the property search API that validates correct behavior without requiring database connectivity or manual setup. The test suite must execute in under 10 seconds via a single command (`npm test`), achieving minimum 60% code coverage with at least one happy path test and one error case test.

The test suite serves dual purposes: (1) regression detection preventing bugs from reaching production, and (2) onboarding tool enabling new developers to verify their local environment works correctly. Tests must validate that actual API behavior matches the documented contract established in orbit bffba690-3729-48f5-9223-6609f344063f, creating a closed-loop verification system where documentation, implementation, and tests remain synchronized.

Critical constraint: The existing `backend/api/properties/search.js` implementation must remain completely unchanged. Tests wrap the existing code through HTTP-layer validation or module-level mocking, never modifying production logic to accommodate testing needs. This ensures tests validate real production behavior, not test-specific code paths.

Success is measured by a developer running `npm test` in a fresh checkout and receiving clear pass/fail results within 10 seconds, with test output providing actionable feedback for any failures. The suite must work offline without database servers, external APIs, or network dependencies.

## Implementation Plan

### Phase 0: API Implementation Analysis and Prior Orbit Review

**Objective:** Understand current API behavior and any modifications from prior orbits before designing tests.

**Actions:**

1. **Read `backend/api/properties/search.js` source code** to determine:
   - HTTP server implementation pattern (vanilla http.createServer vs. framework)
   - Exported functions/modules available for testing
   - Request handling logic (GET/POST methods, query parameters)
   - Response structure and status codes
   - Database interaction approach (imported modules, hardcoded data, etc.)
   - Error handling patterns

2. **Review orbit ffce316e-4d4e-46c6-bb4f-c5310e36a19f artifacts:**
   - Read `intent_document.md` to understand scope of prior work
   - Read `proposal_record.md` to identify any API behavior modifications
   - Determine if API contract changed from original implementation

3. **Review orbit bffba690-3729-48f5-9223-6609f344063f artifacts:**
   - Extract documented response schema from proposal Phase 1 analysis
   - Identify documented error scenarios and HTTP status codes
   - Note any query parameters or request variations documented
   - Confirm expected API behavior to validate in tests

4. **Document findings** in working notes:
   - Current API contract (endpoints, methods, parameters, responses)
   - Testing approach selection (programmatic server vs. module-level)
   - Mocking strategy based on database interaction pattern
   - Test scenarios derived from documentation

**Deliverable:** Analysis document (not committed) guiding test implementation decisions.

**Time Estimate:** 45 minutes

### Phase 1: Test Infrastructure Setup

**Objective:** Create minimal package.json and test directory structure with framework selection.

**Framework Decision Logic:**
```
IF Node.js version >= 18 AND no existing test framework:
  → Use Node.js native test runner (node:test) - zero dependencies
ELSE IF team familiar with Jest:
  → Use Jest - mature ecosystem, built-in coverage
ELSE:
  → Use Mocha + Chai - lightweight, flexible
```

**Recommended:** Node.js native test runner for zero-dependency simplicity, aligning with repository's minimal dependency philosophy.

**Actions:**

1. **Create or update `package.json`:**
```json
{
  "name": "property-search-api",
  "version": "1.0.0",
  "description": "Property search API with automated testing",
  "scripts": {
    "test": "node --test test/**/*.test.js",
    "test:coverage": "node --test --experimental-test-coverage test/**/*.test.js",
    "api": "node backend/api/properties/search.js"
  },
  "devDependencies": {
    "c8": "^8.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

If using Jest alternative:
```json
{
  "scripts": {
    "test": "jest",
    "test:coverage": "jest --coverage"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  }
}
```

2. **Create test directory structure:**
```
test/
  api/
    properties/
      search.test.js
  fixtures/
    properties.js
  helpers/
    server.js
```

3. **Create `.gitignore` entries** (if file doesn't exist, create it):
```
node_modules/
coverage/
.nyc_output/
```

4. **Create `test/helpers/server.js`** - utility for programmatic server control:
```javascript
const { spawn } = require('child_process');
const http = require('http');

/**
 * Start API server on dynamic port for testing
 * @returns {Promise<{port: number, process: ChildProcess}>}
 */
async function startTestServer() {
  const port = await findAvailablePort();
  // Implementation based on Phase 0 analysis of how server starts
}

/**
 * Find available port to avoid conflicts
 */
async function findAvailablePort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

module.exports = { startTestServer };
```

**Files Created:**
- `package.json` (or modified if exists)
- `test/api/properties/search.test.js` (skeleton)
- `test/fixtures/properties.js`
- `test/helpers/server.js`
- `.gitignore` (updated)

**Time Estimate:** 30 minutes

### Phase 2: Fixture Data Creation

**Objective:** Create realistic but synthetic test data based on documented API response structure.

**Actions:**

1. **Create `test/fixtures/properties.js`** with sample property data:
```javascript
/**
 * Sample property data for testing
 * Based on documented API response schema from orbit bffba690-3729-48f5-9223-6609f344063f
 */

const sampleProperties = [
  {
    id: 'prop-test-001',
    address: '123 Test Avenue',
    city: 'Testville',
    state: 'TS',
    zipCode: '12345',
    price: 350000,
    bedrooms: 3,
    bathrooms: 2,
    squareFeet: 1800,
    propertyType: 'single-family',
    status: 'available'
  },
  {
    id: 'prop-test-002',
    address: '456 Example Street',
    city: 'Sampletown',
    state: 'EX',
    zipCode: '67890',
    price: 525000,
    bedrooms: 4,
    bathrooms: 3,
    squareFeet: 2400,
    propertyType: 'townhouse',
    status: 'available'
  }
];

const emptyResult = [];

const errorResponse = {
  error: 'Invalid request',
  message: 'Query parameters validation failed'
};

module.exports = {
  sampleProperties,
  emptyResult,
  errorResponse
};
```

**Note:** Actual fields must match the structure discovered in Phase 0 analysis.

**Files Created:**
- `test/fixtures/properties.js`

**Time Estimate:** 15 minutes

### Phase 3: Core Test Implementation

**Objective:** Implement primary test cases covering happy path and error scenarios.

**Testing Approach** (determined by Phase 0 analysis):

**Approach A: Programmatic Server Testing** (if server doesn't export testable functions)
```javascript
const assert = require('node:assert');
const { describe, it, before, after } = require('node:test');
const http = require('http');
const { startTestServer } = require('../../helpers/server');
const { sampleProperties } = require('../../fixtures/properties');

describe('Property Search API', () => {
  let serverPort;
  let serverProcess;

  before(async () => {
    const server = await startTestServer();
    serverPort = server.port;
    serverProcess = server.process;
  });

  after(() => {
    if (serverProcess) serverProcess.kill();
  });

  describe('GET /api/properties/search', () => {
    it('returns array of properties for successful search', async () => {
      const response = await makeRequest(serverPort, '/api/properties/search');
      
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['content-type'], 'application/json');
      
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body), 'Response should be an array');
      assert.ok(body.length > 0, 'Response should contain properties');
      
      // Validate structure of first property
      const property = body[0];
      assert.ok(property.id, 'Property should have id');
      assert.ok(property.address, 'Property should have address');
      assert.ok(typeof property.price === 'number', 'Price should be number');
    });

    it('returns 400 for invalid query parameters', async () => {
      const response = await makeRequest(
        serverPort, 
        '/api/properties/search?invalid=param'
      );
      
      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.ok(body.error, 'Error response should contain error field');
    });
  });
});

/**
 * Make HTTP request to test server
 */
function makeRequest(port, path) {
  return new Promise((resolve) => {
    http.get(`http://localhost:${port}${path}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });
  });
}
```

**Approach B: Module-Level Testing** (if server exports handler functions)
```javascript
const assert = require('node:assert');
const { describe, it } = require('node:test');
const { handlePropertySearch } = require('../../../backend/api/properties/search');
const { sampleProperties } = require('../../fixtures/properties');

describe('Property Search Handler', () => {
  it('returns properties for valid request', async () => {
    const mockReq = { method: 'GET', url: '/api/properties/search' };
    const mockRes = createMockResponse();
    
    await handlePropertySearch(mockReq, mockRes);
    
    assert.strictEqual(mockRes.statusCode, 200);
    const body = JSON.parse(mockRes.body);
    assert.ok(Array.isArray(body));
  });
});

function createMockResponse() {
  return {
    statusCode: 200,
    headers: null,
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(data) { this.body = data; }
  };
}
```

**Implementation Decision:** Use whichever approach Phase 0 analysis determines is feasible. Approach A is more comprehensive but slower; Approach B is faster but requires exported functions.

**Actions:**

1. **Implement `test/api/properties/search.test.js`** with structure from appropriate approach above

2. **Add test cases covering acceptance criteria:**
   - ✅ Happy path: Successful property search returns array
   - ✅ Error case: Invalid request returns appropriate error
   - ➕ Edge case: Empty result set (if API supports filtering)
   - ➕ Edge case: Large result set handling
   - ➕ Edge case: Special characters in parameters

3. **Ensure descriptive test names and assertions:**
```javascript
it('returns 200 status code with valid JSON array for successful search', async () => {
  // Clear description of expected behavior
  const response = await makeRequest(serverPort, '/api/properties/search');
  
  assert.strictEqual(
    response.statusCode, 
    200, 
    'Successful search should return HTTP 200'
  );
  
  assert.strictEqual(
    response.headers['content-type'],
    'application/json',
    'Response should be JSON content type'
  );
});
```

**Files Created:**
- `test/api/properties/search.test.js` (complete implementation)

**Time Estimate:** 2 hours

### Phase 4: Database Mocking Strategy

**Objective:** Implement mocking approach that satisfies zero external dependencies constraint without modifying production code.

**Strategy Selection** (based on Phase 0 analysis):

**Option 1: Environment-Based Fixture Injection**
If API checks for test environment, inject fixture data through environment variable:
```javascript
// In test setup
process.env.USE_TEST_FIXTURES = 'true';
process.env.TEST_FIXTURE_DATA = JSON.stringify(sampleProperties);
```

**Option 2: Module Mock/Stub**
If API imports database module, use test framework mocking:
```javascript
// Using Node.js mock (Node 18+)
const { mock } = require('node:test');
const dbModule = require('../../../backend/database/client');

mock.method(dbModule, 'query', () => {
  return Promise.resolve(sampleProperties);
});
```

**Option 3: No Mocking Required**
If API already returns hardcoded sample data (suggested by README), tests validate actual responses without mocking.

**Implementation:**

1. **Analyze database interaction pattern** from Phase 0 findings

2. **Implement appropriate mocking strategy** in test setup

3. **Verify mock isolation:** Each test should get fresh mock state

4. **Document mocking approach** in test file comments for future maintainers

**Files Modified:**
- `test/api/properties/search.test.js` (add mocking setup)
- `test/helpers/server.js` (if mocking requires helper utilities)

**Time Estimate:** 1 hour

### Phase 5: Coverage Analysis and Gap Filling

**Objective:** Measure code coverage and add tests to reach target acceptance criteria.

**Actions:**

1. **Run coverage analysis:**
```bash
npm run test:coverage
```

2. **Review coverage report** identifying uncovered branches:
   - Error handling paths
   - Edge case validation
   - Response formatting logic

3. **Add tests for uncovered paths** prioritizing:
   - Critical error handling (should reach 100%)
   - Input validation logic
   - Response transformation code

4. **Example gap-filling test:**
```javascript
it('handles server errors gracefully with 500 status', async () => {
  // Force error condition by mocking database failure
  mock.method(dbModule, 'query', () => {
    throw new Error('Database connection failed');
  });
  
  const response = await makeRequest(serverPort, '/api/properties/search');
  
  assert.strictEqual(response.statusCode, 500);
  const body = JSON.parse(response.body);
  assert.ok(body.error, 'Server error should return error object');
  assert.ok(
    !body.error.includes('Database'), 
    'Error message should not expose internal details'
  );
});
```

5. **Stop when target coverage reached** (80% target, 60% minimum acceptable)

**Files Modified:**
- `test/api/properties/search.test.js` (additional test cases)

**Time Estimate:** 1.5 hours

### Phase 6: Performance Optimization

**Objective:** Ensure test suite completes within 10 second constraint.

**Actions:**

1. **Measure baseline execution time:**
```bash
time npm test
```

2. **If exceeding 10 seconds, optimize:**

**Optimization A: Parallel Execution**
```json
// package.json
{
  "scripts": {
    "test": "node --test --test-concurrency=4 test/**/*.test.js"
  }
}
```

**Optimization B: Shared Server Instance**
```javascript
// Move server startup to outer describe block
describe('Property Search API', () => {
  let server;
  
  before(async () => {
    server = await startTestServer();
  });
  
  after(() => {
    server.process.kill();
  });
  
  // All tests share single server instance
});
```

**Optimization C: Reduce Server Startup Overhead**
- Use module-level testing instead of programmatic server if possible
- Mock HTTP layer instead of actual server
- Cache server instance across test files

3. **Re-measure after optimizations** to confirm < 10 second target

4. **Document performance characteristics** in README

**Files Modified:**
- `package.json` (if adding parallelization flags)
- `test/api/properties/search.test.js` (if restructuring for shared resources)
- `test/helpers/server.js` (if optimizing server startup)

**Time Estimate:** 45 minutes

### Phase 7: README Documentation Update

**Objective:** Document test execution instructions for developers.

**Actions:**

1. **Add "Running Tests" section to `README.md`:**

```markdown
## Running Tests

This repository includes an automated test suite for the property search API.

### Prerequisites

- Node.js 18.0.0 or higher

### Quick Start

1. Install dependencies (if not already installed):
   ```bash
   npm install
   ```

2. Run the test suite:
   ```bash
   npm test
   ```

3. Run tests with coverage report:
   ```bash
   npm run test:coverage
   ```

### Test Structure

Tests are organized in the `test/` directory mirroring the source code structure:

- `test/api/properties/search.test.js` - Property search endpoint tests
- `test/fixtures/` - Sample test data
- `test/helpers/` - Testing utilities

### Expected Output

All tests should pass with output similar to:

```
✔ Property Search API > GET /api/properties/search > returns array of properties (45ms)
✔ Property Search API > GET /api/properties/search > returns 400 for invalid parameters (12ms)

Tests: 2 passed, 2 total
Time: 1.23s
```

### Troubleshooting

**Tests fail with "EADDRINUSE" error:**
- Another process is using port 3000
- Tests use dynamic port allocation and should avoid this issue
- If persists, check for zombie processes: `lsof -i :3000`

**Coverage reports not generating:**
- Ensure Node.js version >= 18.0.0
- Check that `c8` is installed in devDependencies
```

2. **Update existing "Running the sample API" section** if needed to clarify difference between running API for development vs. testing

3. **Add test command to "Structure" section** if appropriate

**Files Modified:**
- `README.md` (add testing documentation)

**Time Estimate:** 20 minutes

### Phase 8: Final Validation

**Objective:** Verify all acceptance criteria met through fresh checkout simulation.

**Actions:**

1. **Simulate fresh developer checkout:**
```bash
# In temporary directory
git clone [repository-url] fresh-test
cd fresh-test
npm install
npm test
```

2. **Verify acceptance criteria checklist:**
   - ✅ Test suite executes via single command without manual setup
   - ✅ At least one test validates successful property search response structure
   - ✅ At least one test validates error handling for invalid requests
   - ✅ Test output clearly identifies passed/failed tests with actionable messages
   - ✅ README includes test execution instructions
   - ✅ All tests pass on current implementation without code changes
   - ✅ Execution completes in < 10 seconds
   - ✅ Coverage reaches minimum 60% (target 80%)

3. **Test output quality review:**
```javascript
// Good: Descriptive failure message
assert.strictEqual(
  response.statusCode, 
  200, 
  'Expected HTTP 200 for successful search, got ${response.statusCode}. Response: ${response.body}'
);

// Bad: Generic failure message
assert.strictEqual(response.statusCode, 200);
```

4. **Security scan of test fixtures:**
- Confirm no real addresses, names, or data patterns
- Verify test IDs use obvious prefixes: "prop-test-001"
- Check for accidental PII in comments or variable names

5. **Create validation checklist document** for human reviewer

**Deliverable:** Confidence that all acceptance criteria met and tests ready for review.

**Time Estimate:** 30 minutes

### Execution Order and Dependencies

```
Phase 0 (Analysis) → Phase 1 (Infrastructure) → Phase 2 (Fixtures)
                                                      ↓
Phase 7 (README) ← Phase 6 (Performance) ← Phase 5 (Coverage) ← Phase 4 (Mocking) ← Phase 3 (Core Tests)
                                                                                             ↓
                                                                                      Phase 8 (Validation)
```

**Critical Path:** Phase 0 → Phase 1 → Phase 3 → Phase 5 → Phase 8

Phases 2, 4, 6, 7 can be parallelized or reordered based on findings from critical path phases.

### Files Summary

| File | Operation | Purpose |
|------|-----------|---------|
| `package.json` | CREATE/MODIFY | Define test scripts and dev dependencies |
| `test/api/properties/search.test.js` | CREATE | Main test suite for property search endpoint |
| `test/fixtures/properties.js` | CREATE | Sample test data for API responses |
| `test/helpers/server.js` | CREATE | Utility for programmatic server control |
| `.gitignore` | MODIFY | Exclude test artifacts from version control |
| `README.md` | MODIFY | Document test execution instructions |

**Total: 4-5 files created, 2 files modified**

## Risk Surface

### Risk: Test Framework Selection Misalignment

**Scenario:** Chosen test framework (Node.js native test runner) incompatible with team's existing tooling or CI/CD pipeline expectations.

**Impact:** Medium — Tests work locally but fail in automated pipeline, or team cannot run tests due to unfamiliarity with framework.

**Mitigation:**
- Phase 0 analysis includes checking for existing test framework hints in repository
- Proposal recommends Node.js native (zero dependency) as default but provides Jest/Mocha alternatives
- Human reviewer (Tier 2 Supervised) validates framework choice before implementation
- Framework selection isolated to Phase 1; changing it later requires minimal rework

**Detection:** Human review flags framework choice as inappropriate for project context.

### Risk: Incorrect API Behavior Assumptions

**Scenario:** Phase 0 analysis misinterprets API implementation, leading to tests that validate incorrect behavior.

**Impact:** High — Tests pass but don't actually verify correct API functionality; false confidence in broken code.

**Mitigation:**
- Phase 0 explicitly requires reading actual implementation code, not assumptions
- Tests must execute against running API and compare actual responses to documented expectations
- Phase 8 validation includes manual API testing to confirm test assertions match reality
- Cross-reference with documentation orbit artifacts (bffba690-3729-48f5-9223-6609f344063f) for expected behavior

**Detection:** 
- Human review identifies mismatch between test assertions and documented API contract
- Phase 8 fresh checkout test fails because tests don't match actual API behavior

### Risk: Database Mocking Bypasses Production Logic

**Scenario:** Mocking strategy replaces so much of the API stack that tests validate mock behavior instead of real code paths.

**Impact:** Critical — Tests become meaningless; production bugs slip through because tests never exercise actual logic.

**Mitigation:**
- Mocking constrained to data layer only (database queries), not business logic
- Prefer testing at HTTP boundary (Approach A) over deep module mocking
- Phase 3 includes validation that mocked paths still execute core API logic
- If API returns hardcoded data (Option 3), no mocking required - test actual responses
- Human reviewer validates mocking strategy doesn't over-isolate system under test

**Detection:**
- Coverage report shows large sections of production code never executed during tests
- Tests pass even when obvious bugs introduced in unmocked code paths

### Risk: Port Conflicts in CI/CD Environment

**Scenario:** Multiple test suites run in parallel on CI server attempting to bind to same port, causing "EADDRINUSE" failures.

**Impact:** Medium — Tests fail intermittently in CI despite passing locally; unreliable pipeline.

**Mitigation:**
- `test/helpers/server.js` implements dynamic port allocation using port 0
- Each test run gets unique ephemeral port from OS
- Alternative: Use module-level testing (Approach B) avoiding server startup entirely
- Document port conflict troubleshooting in README

**Detection:** CI logs show "EADDRINUSE" or port binding errors; tests pass when run individually but fail in parallel.

### Risk: Test Execution Time Exceeds Constraint

**Scenario:** Programmatic server startup overhead causes test suite to exceed 10 second execution constraint.

**Impact:** Medium — Violates acceptance criteria; developers skip running tests locally due to slowness.

**Mitigation:**
- Phase 6 explicitly focuses on performance optimization
- Shared server instance across tests reduces startup overhead
- Parallel test execution (`--test-concurrency`) speeds up suite
- Module-level testing (if available) eliminates server startup entirely
- Continuous monitoring: Phase 8 validation measures actual execution time

**Detection:** `time npm test` shows execution > 10 seconds during Phase 6 or Phase 8.

### Risk: Fixture Data Diverges from Production Schema

**Scenario:** API response structure changes but test fixtures not updated, causing tests to validate outdated contract.

**Impact:** Medium — Tests pass but validate wrong schema; integration issues not caught.

**Mitigation:**
- Fixtures based on actual documented schema from orbit bffba690-3729-48f5-9223-6609f344063f
- Tests validate structure not just values (e.g., `assert.ok(property.id)` checks field exists)
- Phase 8 includes cross-reference with latest documentation
- Future: JSON schema validation (stretch goal) provides automated schema drift detection

**Detection:** API changes merged without corresponding fixture updates; integration tests or production issues reveal schema mismatch.

### Risk: Tests Pass with Backward Compatibility Violation

**Scenario:** Tests accidentally modify production code (violating constraint) and pass only because of those modifications.

**Impact:** High — Constraint violation; tests don't validate actual production behavior.

**Mitigation:**
- Phase 8 validation explicitly checks no changes to `backend/api/properties/search.js`
- Git diff review confirms only test files and README modified
- Human reviewer (Tier 2 Supervised) validates backward compatibility maintained
- Test implementation documented to never require production code changes

**Detection:** 
- Git diff shows modifications to files outside test directory
- Proposal violation identified during human review

### Risk: Inadequate Error Scenario Coverage

**Scenario:** Tests only cover happy path, missing critical error handling paths needed for 80% coverage target.

**Impact:** Medium — Acceptance criteria not met; error handling bugs slip through.

**Mitigation:**
- Phase 5 explicitly focuses on gap filling after coverage analysis
- Minimum acceptance requires at least one error case test
- Target acceptance requires 3 error cases + 2 edge cases
- Coverage report guides additional test creation prioritization

**Detection:** Coverage report in Phase 5 shows < 60% coverage or large uncovered error handling branches.

### Risk: Test Output Not Actionable for Developers

**Scenario:** Tests fail with generic error messages that don't help developers understand what went wrong.

**Impact:** Low-Medium — Increased debugging time; frustrated developers.

**Mitigation:**
- All assertions include descriptive failure messages with context
- Example in Phase 3: `assert.strictEqual(actual, expected, 'Reason why this matters')`
- Test names describe expected behavior: "returns 200 status for successful search"
- Phase 8 validation includes manual review of failure message quality

**Detection:** Developers report difficulty understanding test failures; support questions about test output.

### Risk: Security Information Exposure in Test Fixtures

**Scenario:** Test fixtures accidentally include real property addresses, names, or sensitive data patterns.

**Impact:** Low-Medium — Privacy concern; potential data exposure if tests committed to public repository.

**Mitigation:**
- Phase 2 explicitly uses obviously fictional data with "test" prefixes
- Phase 8 security scan checks for PII patterns (SSN, email, phone)
- Fixtures use synthetic data: "123 Test Avenue", "prop-test-001"
- Human reviewer validates no real data in test artifacts

**Detection:** Automated pattern scanning or human review identifies realistic-looking data in fixtures.

## Scope Estimate

### Complexity Assessment: Medium

**Justification:**
- **Moderate Technical Challenge:** Requires understanding existing API implementation, designing mocking strategy, and selecting appropriate testing approach without modifying production code
- **Architectural Decision:** Framework selection and mocking strategy have long-term maintenance implications requiring human validation (Tier 2 Supervised)
- **Multiple Unknowns:** Phase 0 analysis required before concrete implementation decisions; API structure discovery may reveal unexpected complexity
- **Clear Boundaries:** Scope well-defined (single endpoint, no integration tests); constraints eliminate ambiguity
- **Low Production Risk:** Tests don't affect running systems; errors impact only development workflow

**Complexity Drivers:**
- Understanding undocumented API implementation
- Database mocking without code modification
- Performance optimization to meet 10-second constraint
- Coverage target achievement (80%) may require extensive edge case testing

### Estimated Duration: 6.5-8 hours

**Time Breakdown:**

| Phase | Estimated Time | Confidence | Notes |
|-------|---------------|-----------|-------|
| Phase 0: API Analysis | 45 min | High | Reading code and prior orbit artifacts |
| Phase 1: Infrastructure Setup | 30 min | High | Straightforward package.json and directory creation |
| Phase 2: Fixture Creation | 15 min | High | Simple data structures |
| Phase 3: Core Tests | 2 hours | Medium | Main implementation work; may extend if API complex |
| Phase 4: Database Mocking | 1 hour | Low | Depends heavily on Phase 0 findings |
| Phase 5: Coverage Analysis | 1.5 hours | Medium | Iterative gap-filling; time varies with coverage gaps |
| Phase 6: Performance Optimization | 45 min | Medium | May not be needed if tests already fast |
| Phase 7: README Updates | 20 min | High | Straightforward documentation |
| Phase 8: Final Validation | 30 min | High | Checklist-driven verification |
| **Total** | **7.25 hours** | **Medium** | Mid-range estimate |

**Variability Factors:**
- **+1-2 hours:** Complex API implementation requiring extensive mocking
- **+1 hour:** Low initial coverage requiring many additional tests
- **-1 hour:** Simple API with exported functions enabling fast module-level testing
- **-30 min:** Performance already meets constraint without optimization

### Work Phases: Single Orbit

**This proposal represents a complete orbit** — all phases execute in one continuous session. No natural breakpoints for multi-orbit decomposition exist because:

- Test suite value realized only when complete and passing
- Partial test coverage creates false impression of validation
- Mocking strategy must be consistent across all tests
- Infrastructure setup (Phase 1) enables all subsequent phases

**Milestone Checkpoints Within Orbit:**
1. **Phase 0 Complete:** API analysis finalized; implementation approach selected
2. **Phase 3 Complete:** Minimum acceptance criteria met (happy path + 1 error test)
3. **Phase 5 Complete:** Target acceptance criteria met (80% coverage)
4. **Phase 8 Complete:** All done criteria validated; ready for human review

### Acceptance Criteria Targeting

**Minimum Acceptable (Guaranteed):**
- ✓ 60% code coverage of API handlers
- ✓ Happy path + 1 error case
- ✓ < 10 seconds full suite execution
- ✓ Single test file
- ✓ Basic equality checks with failure messages

**Target (Planned):**
- ✓ 80% code coverage including error paths
- ✓ Happy path + 3 error cases + 2 edge cases
- ✓ < 5 seconds full suite execution
- ✓ Organized test structure with clear naming
- ✓ Descriptive assertions with meaningful failure messages

**Stretch (Opportunistic):**
- ? 90% coverage with edge cases and validation logic — Time permitting after target achieved
- ? Comprehensive parameter combination matrix — Deferred; diminishing returns
- ? < 2 seconds with parallel execution — Implemented if Phase 6 optimization needed
- ? Test utilities and fixtures in reusable modules — Created if code duplication emerges
- ? Custom matchers for API patterns — Lower priority; standard assertions sufficient

### Deliverable Artifacts

**Test Implementation:**
- `test/api/properties/search.test.js` — 200-300 lines with 5-8 test cases
- `test/fixtures/properties.js` — 50-75 lines of sample data
- `test/helpers/server.js` — 75-100 lines of test utilities

**Configuration:**
- `package.json` — Test scripts and dependencies
- `.gitignore` — Coverage exclusions

**Documentation:**
- `README.md` — Testing section (50-75 lines added)

**Total Implementation Volume:** ~450-550 lines across 6 files

**Validation Evidence:**
- Test execution output showing all tests pass
- Coverage report showing 60-80% coverage achieved
- Performance measurement confirming < 10 second execution
- Fresh checkout validation log

## Human Modifications

Pending human review.