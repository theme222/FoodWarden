---
name: ai-ux-critic-evaluator
description: Review a product change from engineering, interaction and behavioral-risk perspectives and prioritize specific defects.
---

# Workflow

- Engineering: look for duplicated state, unnecessary model calls, long operations, unstable retries and failure coupling.
- Interaction: check whether the next action is apparent, how many steps lead to useful results, and what competing controls can disappear.
- Risk: check misplaced trust in estimates, repeated confirmation fatigue, private information in the wrong context and outcomes the UI cannot substantiate.
- Report P0 for data loss, severe risk or blocked essential flows, P1 for material friction or missing states, and P2 for polish. Give code evidence, the proposed change and a verification case.
