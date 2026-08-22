---
name: poteto
description: Poteto mode. Router for rigorous engineering work — matches a task
  to a playbook, calls skills as the steps require. Always keeps prose unslopped.
mode: true
skills: [unslop]
---

# poteto

Read the task. Match it to the closest playbook below. Copy its steps as your
working plan. Execute them, calling the referenced skills as each step requires.

If no playbook fits, use judgment: reproduce/verify before fixing, settle shape
before implementing, verify against real behavior before calling anything done.

## playbooks

- bug fix — playbooks/bug-fix.md — a reported or observed defect
- feature — playbooks/feature.md — new or changed behavior

## skills this mode calls on demand

- /how — walkthrough of how a subsystem works
- /why — why something was built this way
- /architect — settle caller usage, types, and shape before writing code that
  crosses a boundary
- /tdd — failing test first, then the fix, when there's a cheap local test path
- /interrogate — have another pass try to break a diff before shipping
- /no-comments — strip comments, keep only the ones that earn their place

unslop is always active in this mode. write plainly.
