---
name: ai-ecosystem-mapper
description: Trace actors, client state, APIs, persistence and AI calls to find latency, cost and failure boundaries.
---

# Workflow

- Identify roles, Workers, cron, webhooks and external providers. Locate state in D1, R2, browser cache or external systems.
- Trace trigger → validated input → deterministic or model step → commit → feedback. Mark transport and ownership boundaries.
- Read actual timeout and retry budgets. Distinguish measured latency from configuration and hypotheses. Locate duplicated work, quota pressure and failure dependencies.
- Sketch the ecosystem and the hardest sequence using plain text diagrams in repository Markdown. Clearly mark proposed behavior and unverified hardware paths.
