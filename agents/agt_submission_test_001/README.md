# Submission Test Agent

This agent is a zero-dependency fixture for testing the external agent submission flow.

## What it does

- Reads the HR scenario JSON from `stdin`
- Emits one valid signal JSON object to `stdout`
- Avoids network calls, subprocesses, environment-variable access, and third-party packages

## Upload file

Create and upload a zip that contains this folder. A ready-to-upload archive can be generated with:

```bash
zip -r agents/agt_submission_test_001-upload.zip agents/agt_submission_test_001
```

## Suggested submission fields

- Submitter: `Local QA`
- Agent name: `Submission Test Agent`
- Type: `custom`
- Description: `Deterministic fixture agent for exercising the public HR submission pipeline.`
- Claimed edge: `No production edge. This agent is intentionally simple so the pipeline can be tested reliably.`

## Expected behavior

- Quarantine should accept the archive
- Security scan should stay clean
- Conformance should show a valid translated signal
- Paper sim and shadow should execute if local market-data providers are configured
