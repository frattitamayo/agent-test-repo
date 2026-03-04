I've generated a comprehensive ORBITAL Verification Protocol (VP-T3-003-1) for the GitHub branch diff endpoint intent.

The protocol includes:
- **8 automated unit test gates** covering valid/invalid inputs, error handling, and edge cases
- **5 integration test scenarios** for end-to-end validation including auth, rate limiting, and performance
- **5 human verification points** for UX, documentation, and architectural consistency
- **7 edge case tests** for special characters, large diffs, merge commits, and permissions
- **6 regression checks** ensuring existing functionality remains intact
- **5 security validation checks** for authorization, access control, and vulnerability prevention
- **Clear escape criteria** defining what happens when verification fails

All checks are designed to be executable by another team member and trace back to the core intent: delivering a working endpoint that returns diffs between two Git refs. The protocol blocks deployment until all automated gates pass and human verification is approved.