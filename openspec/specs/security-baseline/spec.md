## Purpose

Baseline security posture for the app: secret file permissions, injection-safe subprocess launches, hardened OAuth callback, owner-scoped mpv IPC, and dependency hygiene.

## Requirements

### Requirement: Secret files are owner-only
Files containing credentials or tokens (`tokens.json`, `config.json` when it holds keys) SHALL be created with mode 0600 inside a 0700 config directory, and permissions SHALL be re-hardened on read so files created by older versions get tightened. No secret value SHALL be written to logs or error messages.

#### Scenario: Token file permissions
- **WHEN** tokens are persisted after OAuth login
- **THEN** `tokens.json` has mode 0600 and its parent directory mode 0700

### Requirement: Subprocess arguments are injection-safe
All subprocess launches (mpv, browser openers, provider CLIs) SHALL pass arguments as arrays without shell interpolation, and any value embedded into a shell-interpreted string (e.g. the PowerShell `Start-Process` path on Windows/WSL) SHALL be escaped against quote-breakout. URLs passed to browser openers SHALL be limited to `https:` (and `http://127.0.0.1` for the local callback).

#### Scenario: Malicious track metadata
- **WHEN** a resolved track title or URL contains shell metacharacters or quotes
- **THEN** mpv receives it as a literal argv element and no shell command is executed from it

### Requirement: OAuth callback listener is hardened
The OAuth callback server SHALL bind only to 127.0.0.1, verify the `state` parameter against the value issued for the in-flight login, use PKCE with no client secret anywhere in the codebase, and stop listening once the flow completes or times out.

#### Scenario: Forged callback request
- **WHEN** a request arrives at the callback endpoint with a missing or mismatched `state`
- **THEN** the code exchange is refused and the pending login is not completed by that request

### Requirement: mpv IPC socket is scoped to the owner
The mpv JSON-IPC socket SHALL be connectable only by the owning user (directory or socket permissions enforce this on multi-user systems) and SHALL use a per-process path so concurrent instances cannot cross-drive each other's player.

#### Scenario: Second local user
- **WHEN** another OS user attempts to connect to the running app's mpv IPC socket
- **THEN** the connection is refused by filesystem permissions

### Requirement: Dependency and supply-chain hygiene
The project SHALL have no known critical/high vulnerabilities in production dependencies at release time (verified via `bun audit` or equivalent), and `install.sh` SHALL fetch code only over HTTPS from the pinned repository and verify it checks out a release tag rather than a mutable branch tip.

#### Scenario: Audit gate
- **WHEN** the dependency audit runs against the lockfile
- **THEN** it reports zero unaddressed critical or high severity advisories, or each remaining advisory is documented with a reason it does not apply
