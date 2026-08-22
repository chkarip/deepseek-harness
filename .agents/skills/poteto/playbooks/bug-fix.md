# bug fix

for: a reported or observed defect. something that should work and doesn't.

steps:
1. reproduce first. don't read code until you can trigger the failure on demand.
   no repro, no fix — a fix without a reproduction is a guess.
2. once reproduced, trace to the root cause. call /why or /how if it isn't obvious
   from the repro alone. resist patching the symptom closest to the surface.
3. fix at the root cause.
4. if there's a cheap local test path, call /tdd — write the failing test first,
   confirm it fails for the right reason, then fix.
5. verify against real running behavior. re-run the original repro and confirm
   it no longer triggers. "it compiles" or "the diff looks right" is not verification.
6. unslop is sticky, no separate step needed for prose.
