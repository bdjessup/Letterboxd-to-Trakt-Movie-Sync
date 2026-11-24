# Letterboxd-to-Trakt-Movie-Sync

Documentation source of truth: https://app.notion.com/p/3ff212519f4a81ef90d1e455416c2bfe

- Read that page before changing behavior or setup. Update it in the same task for changes to behavior, setup/run steps, configuration, architecture, data/migrations, integrations or releases/deployment.
- If Notion is unavailable, add `## Notion updates needed` to the PR with the exact page and edits for Release Desk.
- Link to Notion instead of adding parallel repository docs. Code comments and the README quick start are fine.
- Document environment/secret names only, never secret values.

## Shared rules

These rules apply in every one of Ben's repos. Repo-specific rules in this file add to them.

### Git and merging

- Name branches for what the change does, for example `fix-widget-refresh` or `add-export-button`. Never put the agent's or tool's name in a branch name (no `claude/`, `codex/`, `cursor/`, `copilot/` or `gemini/`).
- Every change goes through a pull request. Never push to `main`.
- Auto-merge is allowed only when required checks pass and the PR description documents what changed, why, how it was verified and how to roll it back.
- Do not auto-merge when the repo runs no checks on pull requests, or when merging deploys to production or ships a store build. Those merges need Ben's go-ahead.
- Report actual check results and say which checks were not run. Do not assume a failure already existed; compare with the base branch.

### Production and money

- No production deploys, remote (`--remote`) data changes, store uploads or store metadata pushes without Ben's explicit go-ahead in the current task.
- Be extremely conservative with billing, subscription, in-app purchase and payment code. Every change needs Ben's review and a test. Never create or change store products or prices.
- Never commit secrets. Document secret names only, never values.

### Working style

- Say when you are unsure instead of guessing.
- Default stack for new work: Cloudflare Workers with TanStack Start on the web, Railway for larger backends, and Expo with `@expo/ui` wherever possible for mobile. Do not migrate an existing app's framework or host without Ben's approval.
- On Apple platforms, follow Apple's Human Interface Guidelines and use native controls and Liquid Glass. On Android, keep native Material views.
