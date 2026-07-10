## Rule Precedence

- Treat safety, secrets, and destructive-action constraints as highest priority.
- Follow explicit user requests unless they conflict with safety or repository
  rules.
- Treat explicit user wording such as "do by GI", "follow GI", "strictly by
  GI", and equivalent local-language forms as a request for strict compliance
  with all loaded GI rules. These rules are mandatory execution constraints
  unless the current user message explicitly overrides a specific rule for the
  current task.
- If an applicable GI rule cannot be followed, stop and report the concrete
  blocker or explicit deferral instead of silently continuing.
- Let project-local `AGENTS.md`, runbooks, and working agreements override these
  shared reusable rules when they are more specific.
- Use these shared rules when project-local guidance is absent or ambiguous.
- Agents may ask concise clarification questions about implementation details
  and may propose a better-fit solution, workflow, stack, algorithm, or tradeoff
  when it improves the user's stated goal.
- Prefer token economy and optimization after the correct scope is clear.
