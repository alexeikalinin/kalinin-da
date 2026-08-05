# @ama/agent-frontend

Implements: docs/03-architecture/agent-framework.md (role: Frontend Agent)

Tool Integration §1 flags this role's actual work ("Развёртывание/публикация кода") as an Этап 2 concern — this package models the contract and wiring the same way as every other tool-using role, with the deployment tool injected (`deployment-tool`), not a real hosting provider. No Vercel credentials exist in this environment (see the Roadmap discussion on which real accounts are needed before this can deploy anything real).

Order matters here and is tested explicitly: the model builds the artifact **first**, then the deployment tool is called with it — a deployment failure still means the model already ran (verified in `frontend-agent.test.ts`), unlike Research/SEO/UI Designer where the tool call happens before the model.
