
# Project Documentation

Read the relevant doc before implementing features. All files are in `.claude/doc/`.

| Document | Read when |
|----------|-----------|
| `CURRENT_FEATURES.md` | Understanding what's implemented, roles, API groups, routes |
| `FUNCTIONAL_SPEC_VS_REQUIREMENTS.md` | Requirement traceability, gaps, coverage status |
| `HOW_TO_GUIDE.md` | End-user workflows (Thai) — POS, top-up, void, department charge |
| `BOOKSTORE_POS_SPECIFICATION.md` | Original POS requirement baseline (12 modules) |
| `PARENT_STUDENT_PORTAL_SPEC.md` | Parent/student portal, wallet, family links, SSO |
| `SPENDING_LIMIT_PLAN.md` | Spending groups, daily limits, admin CRUD |
| `README.md` | Quick start, demo accounts, deployment |

Developer guidelines and commands: `AGENTS.md` (repo root or `.claude/doc/AGENTS.md`).

**Note:** Specs written before the Bun migration may reference Python/FastAPI paths. Implementation lives in `backend-bun/src/`.
