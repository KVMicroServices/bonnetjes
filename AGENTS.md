# Rules

## Scope Check
- Is this a QUESTION? → Answer only. NO code changes. NO file edits.
- Is this a TASK? → Do ONLY what was asked. Nothing more.
- Is anything unclear? → ASK before assuming.

**VIOLATING SCOPE = IMMEDIATE FAILURE**

---

## Spec Scope

**Parallelizability** Include wave config similar to this for parallel execution:

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3", "5"] },
    { "id": 2, "tasks": ["4", "6"] }
  ]
}
```

**Checkpoints** Never include checkpoints tasks. all tasks need to be based on actual features and test execution will happen when the user decides.

**Size**: Task lists must stay under 10 tasks, preferably 5 or less. keep them tiny. If a feature needs more, first rethink whether you are over engineering the problem's solution, if not, split it into multiple specs. Before creating any spec, discuss scope with the user and warn if it's trying to do too much at once, and let them tell you if it's simpler than you suspect.

**Sub-tasks**: Try to avoid subtasks at all costs. This ensures we don't over engineer our solutions and improves implementation speed.

**Correctness properties**: Keep them simple and short. Only include what's strictly necessary — exhaustive property testing is rarely worth the time cost.

**Tests**: Every spec task list must include a task for unit tests covering the new service/module logic. Tests are not optional — they are part of the deliverable.

**Philosophy**: Small, focused specs that ship fast. One spec = one deliverable.

---

## ❌ BANNED CODE PATTERNS ❌

These will be rejected. Use the alternative EVERY time.

| BANNED | USE INSTEAD |
|--------|-------------|
| `?? throw` | if-null check |
| `? :` ternary | if-else block |
| Compound assignments | Separate lines |
| Chained operations | One op per line |
| Short-circuit tricks | Explicit if-else |
| Abbreviations | Full words always |
| Single-letter vars | Descriptive names |
| Magic numbers/strings | Named constants |
| `var` for non-obvious types | Explicit type declaration |
| Hidden global state | Explicit dependency wiring |
| `console.*` in production code | Shared Fastify/Pino logger |
| Broad utility dumping grounds | Clear module ownership |

---

## Code Standards

**Readability**: Write code that explains itself. No cleverness.

**Naming**: Full words, long and specific over short and general, never abbreviate

**Structure**: One operation per line, functions focused and concise, early returns over deep nesting

**Organization**: Use header comments in files 100+ lines. Group by logical domain rather than just access level.

**Docs**: Short docstrings on public APIs only. only comment for code that is inherently hard to interpret - refactor unclear code instead where possible.

**Errors**: Warnings = errors. Fix immediately. Strict linter settings. Zero tolerance.

**Null checks**: Avoid defensive null/undefined guards in internal code. Rely on TypeScript strict mode, narrow types, and schema validation. Only guard true external boundaries where input is untrusted, such as HTTP requests, env vars, database payloads, and third-party APIs.

**Modules**: Use ES modules with one clear responsibility per file. Prefer small focused files over region-style organization. Keep imports at the top, group external imports before internal imports, keep ordering consistent.

**Collections**: Use `readonly T[]`, `ReadonlyArray<T>`, `ReadonlySet<T>`, and `ReadonlyMap<K, V>` in public interfaces where mutation should not be allowed. Use concrete mutable types (`T[]`, `Set<T>`, `Map<K, V>`, objects) internally.

## Logging Standards

- Route application logging through the shared logger layer.
- Do not add direct `console.*` calls in production code paths.
- Keep logs event-based, boundary-based, and state-change based; avoid log spam inside tight loops, polling, retries, or high-volume paths.
- Prefer structured fields over string-heavy messages.
- Runtime code involving state changes, error handling, request handling, job processing, or user-facing API behavior must use the shared logger. Skip for DTOs, config, and test files.

## Security

- Validate and sanitize all external input at boundaries (HTTP, env, DB, third-party APIs).
- Use parameterized queries — never interpolate user input into SQL or shell commands.
- Never commit secrets, tokens, or credentials. Use environment variables or secret managers.
- Enforce auth checks on every protected route. Default to deny.
- Avoid exposing sensitive data (stack traces, internal IDs, user PII) in API responses.
- Return generic errors to clients. Log details internally.
- Escape output to prevent XSS. Use framework defaults, don't bypass them.
- Pin dependencies to exact versions. Audit new packages for typosquatting.
- New environment variables must be added to `.env.example` and validated at startup.

## Stability

- Every async call must have error handling. No unhandled promise rejections.
- Guard external boundaries (HTTP, DB, Redis) with timeouts and retries where appropriate.
- Avoid unbounded loops, recursion, and uncapped collection growth.
- Close resources (connections, streams, handles) explicitly — don't rely on GC.
- Fail fast on startup for missing config or unreachable dependencies.
- Isolate failures — one bad request or job must not crash the process.
- Test error paths, not just happy paths.

---

## ⚠️ LOCALIZATION REQUIRED ⚠️

Every user-visible string MUST use the translation system. No exceptions.

| RULE | DETAIL |
|------|--------|
| Hook | `useTranslations("Namespace")` in every component with UI text |
| Keys | Add to ALL 8 language files (`messages/*.json`: en, nl, de, fr, es, af, xh, zu) |
| Namespaces | One per page/component (e.g., `Login`, `Dashboard`, `Settings`) |
| English first | `en.json` is source of truth; translate to other 7 languages |
| No hardcoded strings | Labels, buttons, placeholders, errors, empty states, tooltips — ALL translated |
| Fallback | Missing keys return the key itself (existing behavior) — but this is a bug, not a feature |

**HARDCODED USER-VISIBLE STRINGS = IMMEDIATE FAILURE**

---

## CHANGES.md

**⚠️ ALWAYS update CHANGES.md at the end of every inference chain that makes meaningful code changes.**

Skip only for trivial changes like typos, formatting, or single-line tweaks.

New entries go at TOP of file (descending order). Keep entries minimal.

```
## [XXX] Short imperative summary

**What**: One sentence describing the change
**Why**: One sentence on reasoning (skip if obvious)
**Decisions**: Bullet only non-obvious choices made
- Decision 1
- Decision 2
**Files**: List affected files (skip if <3 files)
```

Rules for entries:
- Number sequentially (001, 002, etc.) - never use dates
- Maximum 5 lines per entry excluding file list
- Skip sections that add no value
- If it's obvious, don't write it

---

## Module Patterns

- Keep domain logic separate from HTTP, database, and Redis concerns.
- Route handlers should stay thin and delegate to services.
- Validate untrusted input at boundaries using schemas.
- Shared infrastructure such as config, logging, db, and redis lives outside domain modules.
- Prefer explicit module exports over singleton-style global state.
- Use small DTOs or schema objects for external payloads.

## What to Test

- Test domain and service logic directly with unit tests.
- Use property-based tests for pure domain rules, transformations, invariants, and edge cases.
- Test route behavior with integration-style HTTP tests.
- Test repositories only where query logic is non-trivial.
- Test utilities only when they contain real branching or transformation logic.
- Add end-to-end tests only for critical flows.
- New domain modules or services must have corresponding tests.

## Adding Tests

1. Place test files under `tests/` by domain, mirroring source layout.
2. Name files `*.test.languageSlug`.
3. Use appropriate library where property-based testing adds value.

## Integration Tests

- Build the app in test mode.
- Use mock injects instead of starting a real HTTP server when possible.
- Use isolated test data and reset state between tests.

## External Dependency Tests

- For tests requiring PostgreSQL or Redis, use isolated test instances or containers.
- Do not point tests at shared dev or production infrastructure.
- Keep these tests focused on repository, queue, or cache behavior.

---

## ⚠️ EXIT CHECKS — REQUIRED BEFORE TASK COMPLETION ⚠️

Run these before finishing any task that touches code:

| CHECK | ACTION |
|-------|--------|
| `npm run check` | Fix any type errors |
| `npm test` | Fix any test failures |
| CHANGES.md | Updated (see rule above) |
| Logger usage | Shared logger in new runtime code with state changes or error handling |
| Test conventions | `*.test.ts`, correct placement, clear scope |
| Input validation | External input validated at boundaries |
| Route handlers | Thin — delegate to services |
| Security | No secrets, no SQL/shell injection, auth on protected routes |
| Stability | Async error handling, no resource leaks, failures isolated |
| Standards | Code follows all rules in this file |

**SKIPPING EXIT CHECKS = IMMEDIATE FAILURE**
