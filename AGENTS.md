# Letterboxd-to-Trakt-Movie-Sync agent instructions

## Documentation lives in Notion
Notion is the source of truth for this project's documentation. This repo's page: https://app.notion.com/p/3ff212519f4a81ef90d1e455416c2bfe. (All repos: https://app.notion.com/p/3ff212519f4a81668c59c236072d9831)
- Before changing how something works, check the Notion page for the current intent and setup.
- When your change affects behavior, setup or run steps, environment variables or secrets (names only, never values), architecture, data models or migrations, integrations, or release/deploy process, update the Notion page in the same task.
- If you can't access Notion, add a `## Notion updates needed` section to your PR description listing exactly what to change on which page. The Release Desk bot applies these.
- Don't create parallel docs in the repo (new READMEs, docs/ files) for things that belong in Notion; link to Notion instead. Code comments and the README's quick start are fine.
- Never put secret values in Notion.
