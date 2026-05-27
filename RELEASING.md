# Releasing

Releases are fully automated by GitHub Actions. Cutting a GitHub Release (or
pushing a `v*` tag) builds and publishes **both** artifacts:

- **npm** — `cloudflare-smtp-gateway` (with build provenance) via
  [`.github/workflows/npm-publish.yml`](.github/workflows/npm-publish.yml)
- **Docker** — `ghcr.io/teamfrontrow-james/cloudflare-smtp-gateway` (multi-arch
  amd64 + arm64) via [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)

## Cut a release

From a clean `main` with CI green:

```bash
npm version patch          # or: minor / major — bumps package.json + creates a tag
git push --follow-tags     # push the commit AND the tag
gh release create vX.Y.Z --generate-notes
```

`npm version` creates the `vX.Y.Z` tag for you; use that exact tag in
`gh release create`. Publishing the release fires both workflows.

## Verify

```bash
npm view cloudflare-smtp-gateway version            # npm is live
docker pull ghcr.io/teamfrontrow-james/cloudflare-smtp-gateway:X.Y.Z
gh run list --workflow=npm-publish.yml --limit 1
gh run list --workflow=docker-publish.yml --limit 1
```

## Requirements / secrets

- **`NPM_TOKEN`** repo secret — an npm **granular access token** with
  *Read and write* on this package and **"Bypass 2FA"** enabled.
  - It currently targets *All packages* (needed for the very first publish).
    Now that the package exists, regenerate a token scoped to **only**
    `cloudflare-smtp-gateway` and replace the secret (`gh secret set NPM_TOKEN`).
- **Provenance** requires `package.json` to keep a correct `repository.url`
  matching this repo — don't remove it, or `npm publish --provenance` fails (E422).
- Docker publishing uses the built-in `GITHUB_TOKEN` (no secret needed); the GHCR
  package must stay **public** for anonymous `docker pull`.

## Notes

- GitHub Actions runners move to Node 24 by default on 2026-06-02; the pinned
  action versions should adopt it automatically.
- Both the tag push and the release-published event can trigger the Docker
  workflow — duplicate runs are harmless (the image push is idempotent).
