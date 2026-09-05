# Tectra Scene Lab

Tectra Scene Lab is the short-video branch of the Telegram network. It sends viewers to the hub through a tagged link and does not depend on raw clip compilations.

## Editorial format

1. Hook in the first two seconds.
2. Brief context in our own words.
3. Short fragments interrupted by original narration, captions, annotations, or analysis.
4. A clear conclusion that adds meaning beyond the source scene.
5. On-screen source: exact title, season, and episode.
6. One call to action leading to the relevant Telegram bot or channel.

Initial series:

- `Почему сцена работает`: direction, editing, music, or performance.
- `Деталь, которую легко пропустить`: one visual or story detail.
- `Персонаж за 45 секунд`: one decision and what it reveals about motivation.

## Publishing rules

- Use only material that is licensed, public domain, or selected for genuine review/criticism after a rights check.
- Attribution is mandatory but does not itself grant permission or make a use fair.
- Do not publish plain scene excerpts, compilations, full openings/endings, or clips with only cosmetic edits.
- Keep the master vertical and watermark-free; export separate platform copies.
- The video must contain our script, voiceover, captions, and a substantive editorial point.
- Do not automate downloading source footage.

## Workflow

1. Add an episode to `content/video-plan.json` using `content/video-episode.template.json`.
2. Record the source and rights basis, exact timecode, title, season, and episode.
3. Write the hook, commentary, voiceover, and Telegram destination.
4. Set `status` to `ready` only when all assets and checks are complete.
5. Run `npm run videos:validate` before rendering or publishing.

The validation is an editorial guardrail, not a legal determination.
