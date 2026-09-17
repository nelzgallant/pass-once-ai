# Pass Once AI — Phase 4: Real Practice Engine

This version connects the Practice screen to the existing Supabase `subjects`, `classes`, `topics`, `questions`, `profiles`, and `quiz_attempts` tables.

## What changed
- Subjects are loaded from Supabase instead of the hard-coded demo list.
- The student's class is matched to `classes`.
- Practice questions are loaded from `questions` through the selected subject's topics.
- Answer checking uses `correct_answer` (`A/B/C/D`).
- Explanations come from the database.
- Completed practice attempts are saved to `quiz_attempts`.
- Dashboard question/correct/accuracy totals come from saved attempts.
- Added JSS1/JSS2/JSS3 to the profile class selector while retaining SS1–SS3.

## Important
The current starter questions have `is_published = false` because they were inserted for testing. This Phase 4 demo intentionally reads verified database questions regardless of that flag so the practice flow can be tested immediately. Before public launch, we should add an admin/content workflow and only show reviewed/published questions.

## Run
1. Keep `supabase-config.js` with the existing browser-safe publishable key. Never add a service-role/secret key.
2. Host this folder on a static host (GitHub Pages is suitable for the PWA).
3. Log in with an account that has a profile set to **JSS 1**.
4. Open Mathematics and choose Practice.
5. The app should load the questions currently stored in Supabase for Mathematics topics in JSS1.

## Current content
The database currently contains starter JSS1 Mathematics questions for LCM, HCF, Fractions, Basic Operations and Decimals. More curriculum content will be added in later phases.
