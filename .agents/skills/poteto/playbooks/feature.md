# feature

for: new or changed behavior, added deliberately rather than in response to a defect.

steps:
1. before writing implementation, call /architect if the feature crosses a function
   or module boundary — settle the caller's usage, the types, and the shape first.
2. build the smallest version that satisfies the actual requirement. no speculative
   generality, no unused flexibility for a future that isn't specified yet.
3. if there's a cheap local test path, call /tdd.
4. verify against real behavior: run it, don't just read the diff.
5. call /interrogate on the diff before considering it done, at least for anything
   non-trivial.
6. unslop is sticky, no separate step needed for prose.
