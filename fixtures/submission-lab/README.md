# Submission Lab Fixtures

These archives back the `Submission Lab` dashboard tab and give us known upload
artifacts for testing the public submit flow.

- `hello-world-agent`: valid, minimal Python submission
- `broken-submission`: archive with no runnable target
- `lookahead-bias`: valid entrypoint, but it explicitly references future data
- `flash-crash-fragile`: valid entrypoint, but intentionally brittle around shock inputs
- `correlated-copycat`: valid entrypoint, but behavior is intentionally generic momentum

The zip files copied into `public/submission-lab-fixtures/` are the ones the app
serves for download.
