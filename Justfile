set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# List recipes
default:
    @just --list

# --- Development ---

# Install dependencies
install:
    pnpm install --frozen-lockfile

# Build the extension
build: install
    pnpm build

# Run lints
lint: install
    pnpm lint

# Run tests
test: install
    pnpm test

# Run all checks
check: lint test build

# Watch for changes and rebuild
watch: install
    pnpm watch

# --- Oracle ---

# Regenerate lexer fixtures from Racket's own syntax-color lexer (needs racket)
oracle:
    pnpm test:oracle

# --- Local install ---

# Package the VSIX and install it locally
install-local: build
    #!/usr/bin/env bash
    set -euo pipefail
    pnpm package
    vsix=$(ls -t *.vsix | head -1)
    code --install-extension "$vsix" --force
    echo "Installed $vsix"

# --- Versioning & Release ---

# Show current version
version:
    @node -p "require('./package.json').version"

# Bump version, commit, tag and push; the Release workflow does the rest
release bump="patch":
    #!/usr/bin/env bash
    set -euo pipefail
    current=$(node -p "require('./package.json').version")
    IFS='.' read -r major minor patch <<< "$current"
    case "{{bump}}" in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
        *) echo "Invalid bump type: {{bump}} (use major, minor, or patch)"; exit 1 ;;
    esac
    version="$major.$minor.$patch"
    just _release "$version"

# Release with an explicit version
release-version version:
    @just _release "{{version}}"

# Re-tag HEAD and re-trigger the release workflow for an existing version
rerun version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    git push
    git tag -d "v$version" 2>/dev/null || true
    git push --delete origin "v$version" 2>/dev/null || true
    git tag "v$version"
    git push origin "v$version"
    echo "Re-triggered release workflow for v$version"

# Delete the GitHub release and retag HEAD so the workflow recreates it
rerelease version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    gh release delete "v$version" -y 2>/dev/null || true
    just rerun "$version"

# Internal: bump package.json, commit, tag, push (the workflow does the rest)
_release version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    npm version "$version" --no-git-tag-version --allow-same-version
    git add package.json
    git commit -m "chore(release): v$version"
    git push
    git tag "v$version"
    git push origin "v$version"
    echo "Tagged v$version — the Release workflow verifies, packages, publishes to both"
    echo "registries and creates the GitHub release. Watch it with: just release-watch"

# Follow the Release workflow run for the current tag
release-watch:
    #!/usr/bin/env bash
    set -euo pipefail
    gh run watch "$(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status

# --- Publishing (dry-run) ---

# Dry-run VSIX packaging (lists files that would be included)
publish-dry: build
    pnpm vsce ls --no-dependencies --allow-unused-files-pattern --allow-missing-repository

# --- Utilities ---

# Clean build artifacts
clean:
    rm -rf dist node_modules *.vsix
