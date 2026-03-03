I've generated the ORBITAL Intent Document for T3-002. The document structures the GitHub file content endpoint requirement into:

- **Objective & Outcome**: Clear statement that users can retrieve file contents with appropriate encoding
- **Constraints**: Authentication boundaries, rate limits, file size limits, security requirements
- **Acceptance Criteria**: 8 testable conditions covering endpoint behavior, encoding handling, metadata, auth, errors, and performance
- **Trust Tier 2 (supervised)**: Justified by authentication/authorization touchpoints and external service integration, though read-only operations limit the blast radius
- **Dependencies**: Maps prerequisites (GitHub OAuth, repository connections) and parallel work (frontend consumers)

The document follows ORBITAL principles by focusing on the *what* (retrieving file content with metadata) without prescribing implementation details, while providing sufficient constraints and acceptance criteria to guide the orbit execution phase.