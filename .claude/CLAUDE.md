# CLAUDE.md

TypeScript on Node.js. Scripts, dependencies and tool versions live in `package.json`, `tsconfig.json` and the lockfile; read them rather than trusting this file for specifics.

## Conventions

Read `CODING_STANDARDS.md` before writing or reviewing code: conventions, test rules, and where shared types and helpers live.

## Definition of done

A change is done when typecheck, lint and the test suite all pass (run the matching `package.json` scripts) and the change meets the Tests section of `CODING_STANDARDS.md`.

## Skills

- Building a feature or fixing a bug test-first → `tdd`
- Something throwing, failing or slow → `diagnosing-bugs`
- Shaping a module's interface or seams → `codebase-design`
- Reviewing a branch or PR → `code-review`
- Writing a PR body → `pr`

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `Lnwpoom/cloud_Developer2`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
