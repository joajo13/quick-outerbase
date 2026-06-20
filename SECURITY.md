# Security Policy

**quick-outerbase** is an unofficial, community-maintained fork of
[Outerbase Studio](https://github.com/outerbase/studio), distributed under AGPL-3.0.
It is **not** affiliated with, endorsed by, or supported by Outerbase. Please report
security issues to **this fork's maintainer**, not to the upstream project.

## Reporting a Vulnerability

Please **do not** open a public issue for security problems. Report privately through
either of these channels:

1. **GitHub Security Advisories (preferred):** open a private report at
   <https://github.com/joajo13/quick-outerbase/security/advisories/new>.
   This keeps the discussion private until a fix ships.
2. **Email:** `juangiupponi2003@gmail.com` — include "quick-outerbase security" in
   the subject and, if possible, encrypt sensitive details.

Please include: affected version (`npx quick-outerbase --version` / the npm version or
git commit), platform, a description of the issue, and reproduction steps or a PoC.

### What to expect

This is a small, community-run fork — there is no SLA. Best effort:

- Acknowledgement of your report within ~7 days.
- An assessment and, if confirmed, a fix or mitigation in a following release.
- Credit in the release notes if you want it (tell us how to attribute you).

## Supported Versions

Only the **latest published release** on npm and the **`main`** branch receive security
fixes. Older versions are not maintained.

| Version            | Supported |
| ------------------ | --------- |
| latest npm release | ✅        |
| `main`             | ✅        |
| anything older     | ❌        |

## Security model (what to know as a user)

- **Local-first tool.** By default the server binds to `127.0.0.1` (loopback) and has
  **no authentication**. That is intentional for a single-user local tool. Do **not**
  expose it on `0.0.0.0` or a public interface without putting your own auth/proxy in
  front of it. See the "Network model" section of the README.
- **Your `DATABASE_URL` stays yours.** It is never persisted or committed; credentials
  are redacted in logs and never sent to any server we control.
- **LLM API keys** live only in your browser's `localStorage`.
- **Runtime integrity.** The npm package is a thin launcher that downloads a
  precompiled runtime from GitHub Releases. Starting with v0.5.0 the launcher verifies
  the SHA-256 of the downloaded bundle against a `checksums.json` shipped inside the
  signed npm package, and the bundles are published from CI with build provenance
  (npm provenance + GitHub artifact attestations). The launcher aborts if the
  downloaded runtime does not match the expected checksum.
