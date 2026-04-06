# ChronoFlow v0

Local-only contradiction-aware temporal workflow engine for distributed systems.

## What It Includes

- React + TypeScript single-page app
- append-only local event ledger persisted in `localStorage`
- time-indexed causal graph visualization
- seed order-fulfillment events with intentional contradictions
- constraint rule engine and contradiction detection
- reconciliation suggestion panel for each detected inconsistency

## Local Tooling

- Bazel is the canonical local build/run entry point
- `bootstrap.sh` is a macOS + Homebrew bootstrapper for Bazelisk, Node, and Docker Desktop
- `setup.sh` installs JavaScript dependencies, warms Bazel's memoized targets, and writes a cached DONE marker in `bazel-bin/chronoflow/setup.done`
- setup and bootstrap take a pid-style filesystem lock under `.chronoflow/locks/`

## Bootstrap

These scripts currently assume macOS with Homebrew available.

```bash
./bootstrap.sh
./setup.sh
```

`bootstrap.sh` installs missing local prerequisites:

- `node`
- `bazelisk`
- `docker-desktop`

If Homebrew is missing, the script exits with an explicit error and asks you to install Homebrew first.

## Bazel Targets

After `./bootstrap.sh` has installed Bazelisk, use Bazelisk directly, or `bazel` if you already have the pinned version installed.

```bash
bazelisk run //:bootstrap
bazelisk run //:setup
bazelisk run //:dev
bazelisk run //:docker_compose_up
bazelisk run //:docker_compose_down
bazelisk run //:docker_dev_logs
bazelisk build //:app_dist_tar
bazelisk build //:local_stack_fingerprint
```

Key targets:

- `//:dev`: runs the Vite dev server on `http://localhost:4173`
- `//:docker_compose_up`: runs `setup.sh` if needed, then starts the dev server in Docker Compose on `http://localhost:4173`
- `//:docker_compose_down`: runs the cached setup check, then stops the Docker Compose stack
- `//:app_dist_tar`: memoized Bazel build target that produces a tarball of the built frontend
- `//:local_stack_fingerprint`: memoized Bazel target that hashes the app plus all local tooling knowledge needed to build and run the project

`setup.sh` is cache-aware. If the prerequisite/build-tooling fingerprint is unchanged and `node_modules/` still exists, it returns quickly instead of rerunning `npm ci` and Bazel warmup. Use `./setup.sh --force` if you want to bypass that cache.

The Bazel workspace is intentionally lightweight. It wraps the existing Node/Vite workflow and gives you stable, cacheable targets without adding a backend.

## Direct Run

```bash
npm install
npm run dev
```

## Direct Build

```bash
npm run build
```

## Docker Compose Dev Server

For containerized local development:

```bash
docker compose up --build chronoflow-dev
```

Or through Bazel:

```bash
bazelisk run //:docker_compose_up
```

The Compose service:

- mounts the repo into `/workspace`
- keeps `node_modules` in a named Docker volume
- auto-runs `npm ci` inside the container when `package.json` or `package-lock.json` changes
- exposes Vite on port `4173`

## Build Outputs

The standard frontend output still lands in `dist/` when you run `npm run build`.

The Bazel build artifact is:

- `bazel-bin/chronoflow-dist.tar`

The Bazel fingerprint artifact is:

- `bazel-bin/local-stack.sha256`
