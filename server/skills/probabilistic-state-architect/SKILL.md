---
name: probabilistic-state-architect
description: Design async and AI workflows for uncertainty, partial results, slow requests, failures and safe recovery.
---

# Workflow

- Enumerate slow work, partial data, incorrect results, low confidence, conflicting updates, unknown outcomes and authorization loss.
- Map idle → validating → processing → needs review, success, partial, error or recovery. Use a state table or plain text in repository Markdown.
- For every state specify trigger, visible feedback, available action, fallback, data preservation and retry identity.
- Separate evidence from inference. Preserve valid cached data for transient failures. Clear protected data on confirmed access loss. Offer granular correction. Promise Undo only if the original identity and data can actually be recovered.
