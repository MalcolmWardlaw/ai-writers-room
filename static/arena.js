/* The arena. Canvas fighters on the left, the actual prose on the right.
 *
 * Two clocks matter here. Events arrive from the server as fast as the models
 * answer, which is not a watchable rate, so everything lands in a queue and is
 * drained one beat at a time. Reconnecting mid-run replays the backlog at speed
 * rather than dumping it, which is why the pump scales its own tempo by depth.
 */
'use strict';

// ---------------------------------------------------------------- palette
/* Families are decided by the model id's VENDOR SLUG, the part before the
 * first slash with any leading tilde stripped, and the slug pattern is
 * anchored. A loose substring test over the whole id is what made `sao10k/*`
 * come out green: the `o1` inside the slug matched OpenAI's `o\d`. The second
 * pattern is the loose one, kept for display names (aliases), which are free
 * text and have no slug to anchor to. */
const FAMILY = [
  [/^anthropic$/,           /anthropic|claude/i,   '#d97757', 'anthropic'],
  [/^openai$/,              /openai|gpt|^o\d/i,    '#12a37e', 'openai'],
  [/^google(-.+)?$/,        /google|gemini/i,      '#5b8dee', 'google'],
  [/^x-ai$/,                /x-ai|grok/i,          '#cdd8e6', 'x-ai'],
  [/^deepseek$/,            /deepseek/i,           '#8b5cf6', 'deepseek'],
  [/^(meta-llama|meta)$/,   /meta|llama/i,         '#c084fc', 'meta'],
  [/^(mistralai|mistral)$/, /mistral|magistral/i,  '#f59e0b', 'mistral'],
  [/^(qwen|alibaba)$/,      /qwen|alibaba/i,       '#ec4899', 'qwen'],
  [/^cohere$/,              /cohere|command/i,     '#22d3ee', 'cohere'],
  [/^z-ai$/,                /z\.?ai|glm/i,         '#6366f1', 'z-ai'],
  [/^nvidia$/,              /nvidia|nemotron/i,    '#76b900', 'nvidia'],
  [/^bytedance(-.+)?$/,     /bytedance|doubao/i,   '#38bdf8', 'bytedance'],
  [/^amazon$/,              /amazon/i,             '#ff9900', 'amazon'],
  [/^perplexity$/,          /perplexity|sonar/i,   '#3fb1c0', 'perplexity'],
  [/^microsoft$/,           /microsoft|phi-\d/i,   '#f25022', 'microsoft'],
];

/** The vendor slug: `~anthropic/claude-fable-latest` and a bare `anthropic`
 *  both reduce to `anthropic`. */
const vendorSlug = model => (model || '').replace(/^~+/, '').split('/')[0].toLowerCase();

/* The family for a model id, or null. The slug decides it. An id with no
 * slash at all (a hand-typed `gpt-5`, say) has no vendor to anchor to, so it
 * falls back to the loose pattern, as does the alias. */
function familyFor(model, alias) {
  const slug = vendorSlug(model), bare = slug && !(model || '').includes('/');
  for (const f of FAMILY) if (f[0].test(slug)) return f;
  for (const f of FAMILY) if (bare && f[1].test(slug)) return f;
  for (const f of FAMILY) if (alias && f[1].test(alias)) return f;
  return null;
}

const SPARE = ['#e879f9', '#fb7185', '#34d399', '#facc15', '#60a5fa'];
let spareAt = 0;
const colorFor = (model, alias) => {
  const f = familyFor(model, alias);
  return f ? f[2] : SPARE[spareAt++ % SPARE.length];
};

/* Provider marks, authored here as plain geometry rather than fetched, so the
 * page works offline and the repo ships no third-party artwork. Each builder
 * draws into a 100x100 box and drawMark scales it onto the doge's forehead.
 * Keyed by the FAMILY key, so the mark and the colour cannot disagree.
 * A provider with no mark falls back to its initial in the family colour. */
/* Official emblems, traced from freely licensed SVGs on Wikimedia Commons and
 * normalised into the same 100x100 box the hand-drawn marks use. Each is the
 * symbol only, with any wordmark dropped. Source files, all public domain as
 * reported by the Commons imageinfo API:
 *   Claude_AI_logo.svg, XAI-Logo.svg, Google_Gemini_logo_2025.svg,
 *   OpenAI_logo_2025_(symbol).svg, Meta_Platforms_Inc._logo.svg,
 *   Mistral_AI_logo_(2025–).svg, Z.ai_(company_logo).svg,
 *   ByteDance_logo_English.svg, Amazon_icon.svg, Perplexity_AI_logo.svg,
 *   Microsoft_logo.svg
 * Three more are free but not public domain, so their terms are recorded:
 *   Deepseek-logo-icon.svg (CC0), Qwen_Logo.svg (Apache 2.0)
 * Cohere, Moonshot AI, MiniMax and Tencent have no usable free symbol on
 * Commons, so they keep the hand-drawn mark or the letter fallback. IBM does,
 * but the 8-bar wordmark is 2.7:1 and turns to hash below about 40px.
 * Trademark is separate and unaffected: these identify which model wrote a
 * draft, which is nominative use, and they must not be used to suggest any
 * endorsement.
 * Filled with the nonzero rule, as the sources are, so the OpenAI knot keeps
 * its holes and the xAI bars stay solid where they cross. */
const LOGO = {
  claude: 'M 21.46,65.51 L 39.94,55.14 L 40.25,54.24 L 39.94,53.74 L 39.04,53.74 L 35.95,53.55 L 25.39,53.26 L 16.23,52.88 L 7.35,52.40 L 5.12,51.93 L 3.03,49.17 L 3.24,47.79 L 5.12,46.53 L 7.81,46.76 L 13.76,47.17 L 22.67,47.79 L 29.15,48.17 L 38.73,49.16 L 40.25,49.16 L 40.47,48.55 L 39.95,48.17 L 39.54,47.79 L 30.31,41.53 L 20.32,34.92 L 15.09,31.11 L 12.26,29.19 L 10.83,27.38 L 10.22,23.43 L 12.79,20.60 L 16.24,20.84 L 17.12,21.07 L 20.61,23.76 L 28.08,29.54 L 37.83,36.72 L 39.26,37.91 L 39.83,37.50 L 39.90,37.22 L 39.26,36.15 L 33.95,26.56 L 28.30,16.81 L 25.78,12.77 L 25.11,10.35 C 24.88,9.35 24.70,8.51 24.70,7.49 L 27.63,3.52 L 29.25,3.0 L 33.15,3.52 L 34.79,4.95 L 37.21,10.49 L 41.14,19.22 L 47.23,31.09 L 49.01,34.61 L 49.97,37.87 L 50.32,38.87 L 50.94,38.87 L 50.94,38.30 L 51.44,31.61 L 52.36,23.40 L 53.26,12.84 L 53.57,9.86 L 55.05,6.30 L 57.97,4.37 L 60.25,5.46 L 62.13,8.15 L 61.87,9.89 L 60.76,17.15 L 58.57,28.51 L 57.14,36.13 L 57.97,36.13 L 58.92,35.17 L 62.77,30.06 L 69.24,21.97 L 72.10,18.76 L 75.43,15.22 L 77.57,13.53 L 81.61,13.53 L 84.58,17.95 L 83.25,22.52 L 79.09,27.80 L 75.64,32.27 L 70.69,38.93 L 67.60,44.26 L 67.89,44.68 L 68.62,44.61 L 79.80,42.24 L 85.84,41.14 L 93.04,39.91 L 96.31,41.43 L 96.66,42.98 L 95.38,46.14 L 87.67,48.05 L 78.63,49.85 L 65.17,53.04 L 65.01,53.16 L 65.20,53.39 L 71.26,53.96 L 73.86,54.10 L 80.21,54.10 L 92.03,54.99 L 95.12,57.03 L 96.97,59.53 L 96.66,61.43 L 91.90,63.85 L 85.48,62.33 L 70.50,58.77 L 65.36,57.49 L 64.65,57.49 L 64.65,57.91 L 68.93,62.10 L 76.78,69.18 L 86.61,78.32 L 87.11,80.58 L 85.84,82.36 L 84.51,82.17 L 75.88,75.67 L 72.55,72.75 L 65.01,66.40 L 64.50,66.40 L 64.50,67.06 L 66.24,69.61 L 75.42,83.41 L 75.90,87.64 L 75.23,89.01 L 72.85,89.84 L 70.24,89.37 L 64.87,81.83 L 59.32,73.33 L 54.85,65.72 L 54.30,66.03 L 51.67,94.46 L 50.43,95.91 L 47.57,97.0 L 45.19,95.19 L 43.93,92.27 L 45.19,86.49 L 46.72,78.95 L 47.95,72.95 L 49.07,65.50 L 49.74,63.03 L 49.69,62.86 L 49.15,62.93 L 43.53,70.64 L 34.99,82.18 L 28.24,89.41 L 26.62,90.05 L 23.82,88.60 L 24.08,86.01 L 25.64,83.70 L 34.99,71.80 L 40.63,64.43 L 44.27,60.18 L 44.25,59.56 L 44.03,59.56 L 19.20,75.69 L 14.78,76.26 L 12.87,74.47 L 13.11,71.55 L 14.01,70.60 L 21.48,65.46 L 21.45,65.48 L 21.46,65.51',
  xai: 'M 7.65,36.23 L 50.20,97.0 L 69.12,97.0 L 26.56,36.23 L 7.65,36.23 M 7.63,97.0 L 26.55,97.0 L 36.01,83.50 L 26.55,69.98 L 7.63,97.0 M 92.37,3.0 L 73.45,3.0 L 40.74,49.71 L 50.21,63.22 L 92.37,3.0 M 76.87,97.0 L 92.37,97.0 L 92.37,9.76 L 76.87,31.90 L 76.87,97.0',
  gemini: 'M 86.82,45.02 C 79.57,41.90 73.24,37.63 67.80,32.20 C 62.37,26.76 58.10,20.43 54.98,13.18 C 53.78,10.41 52.82,7.55 52.08,4.63 C 51.84,3.67 50.99,3.0 50.00,3.0 C 49.01,3.0 48.16,3.67 47.92,4.63 C 47.18,7.55 46.22,10.41 45.02,13.18 C 41.90,20.43 37.63,26.76 32.20,32.20 C 26.76,37.63 20.43,41.90 13.18,45.02 C 10.41,46.22 7.55,47.18 4.63,47.92 C 3.67,48.16 3.00,49.01 3.00,50.00 C 3.00,50.99 3.67,51.84 4.63,52.08 C 7.55,52.82 10.41,53.78 13.18,54.98 C 20.43,58.10 26.76,62.37 32.20,67.80 C 37.63,73.24 41.90,79.57 45.02,86.82 C 46.22,89.59 47.18,92.45 47.92,95.37 C 48.16,96.33 49.01,97.0 50.00,97.0 C 50.99,97.0 51.84,96.33 52.08,95.37 C 52.82,92.45 53.78,89.59 54.98,86.82 C 58.10,79.57 62.37,73.24 67.80,67.80 C 73.24,62.37 79.57,58.10 86.82,54.98 C 89.59,53.78 92.45,52.82 95.37,52.08 C 96.33,51.84 97.00,50.99 97.00,50.00 C 97.00,49.01 96.33,48.16 95.37,47.92 C 92.45,47.18 89.59,46.22 86.82,45.02',
  openai: 'M 57.04,96.58 Q 52.38,96.58 48.19,94.80 A 24.28,24.28 0.0 0,1 40.73,89.87 A 22.58,22.58 0.0 0,1 33.37,91.08 A 22.58,22.58 0.0 0,1 21.82,88.01 A 24.11,24.11 0.0 0,1 13.25,79.62 A 22.58,22.58 0.0 0,1 10.09,67.80 Q 10.09,65.09 10.83,61.92 A 24.84,24.84 0.0 0,1 5.05,54.01 A 22.98,22.98 0.0 0,1 5.15,34.81 A 23.71,23.71 0.0 0,1 11.11,26.81 A 21.45,21.45 0.0 0,1 20.14,22.05 A 22.02,22.02 0.0 0,1 24.43,12.55 Q 27.78,8.27 32.63,5.84 A 22.81,22.81 0.0 0,1 42.97,3.42 Q 47.63,3.42 51.82,5.19 Q 56.01,6.96 59.27,10.13 A 22.58,22.58 0.0 0,1 66.63,8.92 Q 72.88,8.92 78.18,11.99 A 23.37,23.37 0.0 0,1 86.66,20.38 Q 89.92,25.69 89.92,32.20 Q 89.92,34.91 89.17,38.08 Q 92.90,41.52 94.95,46.09 Q 97.0,50.56 97.0,55.49 Q 97.0,60.53 94.85,65.19 A 24.28,24.28 0.0 0,1 88.80,73.29 A 21.45,21.45 0.0 0,1 79.86,77.95 A 21.45,21.45 0.0 0,1 75.48,87.45 A 22.92,22.92 0.0 0,1 67.38,94.16 A 22.81,22.81 0.0 0,1 57.03,96.58 M 34.02,84.94 Q 38.68,84.94 42.12,82.98 L 59.64,72.92 A 2.03,2.03 0.0 0,0 60.57,71.15 L 60.57,63.13 L 38.03,76.08 A 3.78,3.78 0.0 0,1 33.93,76.08 L 16.33,65.93 A 2.82,2.82 0.0 0,1 16.23,66.58 L 16.23,67.70 Q 16.23,72.45 18.47,76.46 Q 20.80,80.37 24.90,82.60 A 18.07,18.07 0.0 0,0 34.03,84.93 M 34.96,69.74 A 2.26,2.26 0.0 0,0 35.98,70.03 Q 36.45,70.03 36.91,69.74 L 43.90,65.73 L 21.45,52.69 A 3.95,3.95 0.0 0,1 19.40,49.06 L 19.40,28.85 Q 14.74,30.89 11.95,35.19 A 16.37,16.37 0.0 0,0 9.15,44.50 Q 9.15,49.07 11.48,53.25 Q 13.81,57.45 17.54,59.59 L 34.96,69.74 M 57.03,90.42 Q 61.97,90.42 65.98,88.19 A 16.71,16.71 0.0 0,0 74.64,73.28 L 74.64,53.16 A 1.81,1.81 0.0 0,0 73.71,51.48 L 66.63,47.39 L 66.63,73.38 A 3.95,3.95 0.0 0,1 64.58,77.01 L 46.97,87.17 A 16.94,16.94 0.0 0,0 57.04,90.42 M 60.58,56.33 L 60.58,43.67 L 50.05,37.70 L 39.43,43.67 L 39.43,56.33 L 50.05,62.30 L 60.58,56.33 M 33.38,26.62 A 3.95,3.95 0.0 0,1 35.43,22.98 L 53.04,12.83 A 16.94,16.94 0.0 0,0 42.98,9.57 Q 38.04,9.57 34.03,11.81 A 16.71,16.71 0.0 0,0 27.69,17.95 A 17.33,17.33 0.0 0,0 25.46,26.71 L 25.46,46.74 Q 25.46,47.86 26.39,48.51 L 33.37,52.61 L 33.38,26.62 M 80.71,71.15 Q 85.36,69.09 88.06,64.81 Q 90.86,60.53 90.86,55.49 A 17.78,17.78 0.0 0,0 88.53,46.74 Q 86.20,42.55 82.47,40.40 L 65.05,30.34 Q 64.49,29.97 64.03,30.06 A 1.69,1.69 0.0 0,0 63.10,30.35 L 56.11,34.25 L 78.65,47.39 A 3.39,3.39 0.0 0,1 80.14,48.88 A 3.61,3.61 0.0 0,1 80.71,50.93 L 80.71,71.15 M 61.98,23.83 A 3.56,3.56 0.0 0,1 66.08,23.83 L 83.78,34.16 L 83.78,32.49 Q 83.78,28.02 81.54,24.01 A 16.15,16.15 0.0 0,0 75.30,17.49 Q 71.29,15.06 65.99,15.06 Q 61.33,15.06 57.88,17.02 L 40.36,27.08 A 2.03,2.03 0.0 0,0 39.43,28.86 L 39.43,36.86 L 61.98,23.83',
  deepseek: 'M 96.01,21.22 C 95.02,20.73 94.59,21.66 94.01,22.13 C 93.81,22.29 93.64,22.48 93.47,22.67 C 92.02,24.22 90.32,25.24 88.09,25.12 C 84.85,24.94 82.07,25.96 79.62,28.44 C 79.10,25.38 77.37,23.55 74.74,22.38 C 73.36,21.77 71.96,21.16 71.00,19.83 C 70.32,18.89 70.14,17.83 69.80,16.80 C 69.59,16.17 69.37,15.53 68.65,15.43 C 67.87,15.31 67.57,15.96 67.26,16.51 C 66.04,18.75 65.56,21.22 65.61,23.72 C 65.71,29.34 68.09,33.82 72.81,37.01 C 73.34,37.37 73.48,37.74 73.31,38.27 C 72.99,39.37 72.61,40.43 72.27,41.53 C 72.06,42.23 71.73,42.38 70.98,42.08 C 68.39,41.00 66.16,39.40 64.18,37.46 C 60.83,34.22 57.79,30.64 54.01,27.83 A 44.20,44.20 0.0 0,0 51.31,25.99 C 47.45,22.24 51.82,19.16 52.83,18.80 C 53.89,18.41 53.20,17.10 49.78,17.12 C 46.37,17.13 43.24,18.28 39.26,19.80 C 38.68,20.03 38.06,20.20 37.43,20.33 C 33.82,19.65 30.07,19.50 26.14,19.94 C 18.76,20.76 12.86,24.25 8.53,30.21 C 3.32,37.37 2.09,45.51 3.60,54.00 C 5.17,62.94 9.74,70.35 16.75,76.14 C 24.03,82.14 32.41,85.08 41.97,84.52 C 47.77,84.18 54.24,83.41 61.53,77.24 C 63.37,78.15 65.30,78.52 68.50,78.79 C 70.97,79.02 73.34,78.67 75.18,78.29 C 78.06,77.68 77.86,75.01 76.82,74.52 C 68.38,70.59 70.23,72.19 68.55,70.90 C 72.84,65.82 79.30,60.55 81.83,43.47 C 82.03,42.11 81.86,41.26 81.83,40.16 C 81.81,39.49 81.97,39.23 82.73,39.15 C 84.85,38.91 86.90,38.33 88.78,37.30 C 94.25,34.31 96.46,29.40 96.98,23.52 C 97.06,22.62 96.96,21.69 96.01,21.22 L 96.01,21.22 L 96.01,21.22 M 48.36,74.16 C 40.18,67.73 36.21,65.61 34.57,65.70 C 33.04,65.79 33.31,67.54 33.65,68.69 C 34.00,69.81 34.46,70.59 35.11,71.58 C 35.55,72.24 35.86,73.21 34.66,73.94 C 32.03,75.57 27.45,73.40 27.23,73.29 C 21.90,70.15 17.44,66.00 14.30,60.34 C 11.27,54.88 9.51,49.03 9.22,42.78 C 9.14,41.27 9.59,40.74 11.09,40.46 C 13.06,40.10 15.10,40.02 17.08,40.31 C 25.42,41.53 32.53,45.26 38.49,51.18 C 41.89,54.54 44.47,58.57 47.12,62.50 C 49.94,66.67 52.97,70.65 56.83,73.91 C 58.19,75.06 59.28,75.92 60.32,76.56 C 57.18,76.91 51.94,76.99 48.36,74.16 L 48.36,74.16 M 52.31,48.64 C 52.44,48.12 52.92,47.73 53.49,47.73 A 1.18,1.18 0.0 0,1 53.90,47.81 C 54.07,47.87 54.22,47.96 54.35,48.10 C 54.56,48.31 54.68,48.62 54.68,48.94 C 54.68,49.61 54.15,50.14 53.47,50.14 A 1.18,1.18 0.0 0,1 52.30,49.14 A 1.25,1.25 0.0 0,1 52.31,48.64 L 52.31,48.64 M 64.06,55.34 C 63.41,55.59 62.77,55.78 62.14,55.81 C 60.98,55.87 59.71,55.40 59.02,54.82 C 57.95,53.92 57.18,53.42 56.86,51.85 C 56.72,51.18 56.80,50.14 56.92,49.55 C 57.20,48.27 56.89,47.44 55.99,46.70 C 55.25,46.09 54.32,45.92 53.29,45.92 C 52.91,45.92 52.56,45.75 52.30,45.62 C 51.87,45.40 51.51,44.87 51.85,44.21 C 51.96,44.00 52.48,43.48 52.60,43.39 C 54.00,42.60 55.60,42.86 57.09,43.45 C 58.47,44.02 59.51,45.05 61.01,46.51 C 62.54,48.28 62.82,48.77 63.69,50.10 C 64.38,51.13 65.01,52.20 65.44,53.42 C 65.66,54.05 65.46,54.60 64.86,54.98 C 64.61,55.13 64.33,55.24 64.06,55.34',
  meta: 'M 13.60,38.75 C 13.60,41.87 14.28,44.26 15.18,45.71 C 16.35,47.61 18.10,48.41 19.88,48.41 C 22.18,48.41 24.28,47.84 28.33,42.23 C 31.58,37.74 35.41,31.43 37.98,27.48 L 42.34,20.78 C 45.37,16.13 48.88,10.96 52.90,7.45 C 56.18,4.59 59.72,3.0 63.28,3.0 C 69.26,3.0 74.96,6.47 79.32,12.97 C 84.09,20.08 86.40,29.05 86.40,38.30 C 86.40,43.81 85.32,47.85 83.47,51.04 C 81.69,54.13 78.22,57.21 72.37,57.21 L 72.37,48.41 C 77.38,48.41 78.63,43.81 78.63,38.55 C 78.63,31.05 76.88,22.73 73.03,16.78 C 70.29,12.56 66.75,9.99 62.85,9.99 C 58.64,9.99 55.25,13.16 51.43,18.83 C 49.41,21.84 47.33,25.51 44.99,29.66 L 42.42,34.21 C 37.25,43.37 35.94,45.46 33.36,48.90 C 28.83,54.93 24.97,57.21 19.88,57.21 C 13.84,57.21 10.02,54.60 7.66,50.66 C 5.73,47.45 4.78,43.24 4.78,38.44 L 13.60,38.75 M 20.55,49.34 C 24.59,43.11 30.42,38.75 37.11,38.75 C 40.99,38.75 44.84,39.90 48.86,43.18 C 53.26,46.77 57.95,52.69 63.80,62.43 L 65.90,65.93 C 70.96,74.36 73.84,78.70 75.53,80.75 C 77.70,83.38 79.22,84.16 81.19,84.16 C 86.19,84.16 87.44,79.56 87.44,74.30 L 95.22,74.06 C 95.22,79.56 94.13,83.60 92.29,86.79 C 90.51,89.88 87.03,92.97 81.19,92.97 C 77.56,92.97 74.34,92.18 70.78,88.82 C 68.04,86.24 64.84,81.66 62.38,77.55 L 55.06,65.32 C 51.39,59.18 48.02,54.61 46.07,52.54 C 43.97,50.31 41.27,47.62 36.97,47.62 C 33.49,47.62 30.53,50.06 28.06,53.80 L 20.55,49.34 M 43.92,58.20 C 40.44,58.20 37.48,60.65 35.01,64.39 C 31.51,69.67 29.36,77.54 29.36,85.09 C 29.36,88.21 30.05,90.60 30.94,92.05 L 23.43,97.0 C 21.50,93.79 20.55,89.58 20.55,84.78 C 20.55,76.05 22.94,66.95 27.50,59.93 C 31.54,53.70 37.37,49.34 44.06,49.34 L 43.92,58.20',
  mistral: 'M 16.43,16.74 L 29.85,16.74 L 29.85,30.04 L 16.43,30.04 L 16.43,16.74 M 70.14,16.74 L 83.56,16.74 L 83.56,30.04 L 70.14,30.04 L 70.14,16.74 M 16.43,30.04 L 43.28,30.04 L 43.28,43.34 L 16.43,43.34 L 16.43,30.04 M 56.71,30.04 L 83.57,30.04 L 83.57,43.34 L 56.71,43.34 L 56.71,30.04 M 16.43,43.34 L 83.57,43.34 L 83.57,56.64 L 16.43,56.64 L 16.43,43.34 M 16.43,56.65 L 29.85,56.65 L 29.85,69.95 L 16.43,69.95 L 16.43,56.65 M 43.28,56.65 L 56.71,56.65 L 56.71,69.95 L 43.28,69.95 L 43.28,56.65 M 70.14,56.65 L 83.56,56.65 L 83.56,69.95 L 70.14,69.95 L 70.14,56.65 M 3.0,69.96 L 43.29,69.96 L 43.29,83.26 L 3.0,83.26 L 3.0,69.96 M 56.71,69.96 L 97.0,69.96 L 97.0,83.26 L 56.71,83.26 L 56.71,69.96',
  qwen: 'M 64.80,40.27 C 65.01,40.27 65.06,40.38 64.95,40.54 L 61.38,46.79 L 50.23,66.41 C 50.23,66.51 50.13,66.51 50.02,66.51 C 49.92,66.51 49.86,66.51 49.81,66.41 L 35.04,40.64 C 34.93,40.48 35.04,40.43 35.14,40.43 L 36.09,40.43 C 36.09,40.43 64.85,40.33 64.85,40.33 L 64.85,40.33 L 64.80,40.27 M 37.93,5.99 C 37.82,5.99 37.77,5.99 37.72,6.10 L 25.47,27.55 C 25.36,27.76 25.15,27.86 24.89,27.86 L 12.64,27.86 C 12.37,27.86 12.32,27.97 12.48,28.18 L 37.30,71.61 C 37.40,71.77 37.35,71.87 37.14,71.87 L 25.20,71.87 C 24.83,71.87 24.52,72.08 24.36,72.45 L 18.74,82.34 C 18.52,82.65 18.63,82.86 19.05,82.86 L 43.50,82.86 C 43.71,82.86 43.87,82.97 43.92,83.18 L 49.92,93.69 C 50.13,94.06 50.28,94.06 50.49,93.69 L 71.89,56.26 L 75.26,50.37 C 75.26,50.26 75.36,50.26 75.47,50.26 C 75.57,50.26 75.63,50.26 75.68,50.37 L 81.78,61.20 C 81.88,61.36 82.04,61.46 82.25,61.46 L 94.08,61.36 C 94.14,61.36 94.19,61.36 94.24,61.25 C 94.24,61.20 94.24,61.15 94.24,61.09 L 81.83,39.33 C 81.73,39.17 81.73,39.01 81.83,38.85 L 83.09,36.70 L 87.88,28.23 C 87.98,28.07 87.88,27.97 87.72,27.97 L 38.14,27.97 C 37.87,27.97 37.82,27.86 37.98,27.65 L 44.13,16.93 C 44.24,16.77 44.24,16.61 44.13,16.45 L 38.30,6.20 C 38.30,6.10 38.19,6.04 38.08,6.04 L 38.08,6.04 L 37.93,5.99 M 52.60,4.31 C 54.28,7.25 55.96,10.20 57.59,13.19 C 57.75,13.46 57.96,13.56 58.28,13.56 L 81.99,13.56 C 82.73,13.56 83.36,14.03 83.88,14.98 L 90.09,25.97 C 90.88,27.39 91.14,28.02 90.19,29.55 C 89.09,31.39 87.98,33.23 86.93,35.12 L 85.35,37.96 C 84.88,38.80 84.41,39.17 85.20,40.17 L 96.55,59.99 C 97.29,61.25 97.03,62.09 96.40,63.30 C 94.50,66.67 92.61,69.98 90.67,73.29 C 89.98,74.45 89.14,74.87 87.77,74.87 C 84.46,74.82 81.15,74.87 77.84,74.92 C 77.68,74.92 77.57,75.03 77.47,75.13 C 73.63,81.92 69.79,88.65 65.90,95.38 C 65.16,96.64 64.27,96.95 62.80,96.95 C 58.54,96.95 54.23,96.95 49.92,96.95 C 49.02,96.95 48.39,96.59 47.92,95.80 L 42.19,85.86 C 42.13,85.70 41.98,85.65 41.82,85.65 L 19.94,85.65 C 18.74,85.75 17.58,85.65 16.53,85.28 L 9.69,73.45 C 9.27,72.66 9.27,71.93 9.69,71.14 L 14.84,62.09 C 15.00,61.83 15.00,61.52 14.84,61.25 C 12.16,56.57 9.48,51.95 6.85,47.27 L 3.49,41.32 C 2.80,40.01 2.75,39.22 3.91,37.22 C 5.91,33.75 7.85,30.28 9.85,26.81 C 10.43,25.81 11.16,25.39 12.32,25.39 C 16.00,25.39 19.68,25.39 23.41,25.39 C 23.63,25.39 23.78,25.29 23.89,25.13 L 35.88,4.20 C 36.30,3.52 36.88,3.15 37.66,3.15 C 39.93,3.15 42.19,3.15 44.45,3.15 L 48.81,3.05 C 50.28,3.05 51.91,3.20 52.65,4.52 L 52.60,4.31',
  zai: 'M 52.38,10.08 L 45.81,19.42 C 44.79,20.89 43.08,21.80 41.26,21.80 L 5.38,21.80 L 5.38,10.02 C 5.32,10.08 52.38,10.08 52.38,10.08 M 97.0,10.08 L 40.6,89.98 L 3.0,89.98 L 59.4,10.08 L 97.0,10.08 M 47.62,89.98 L 54.25,80.58 C 55.26,79.11 56.97,78.2 58.79,78.2 L 94.62,78.2 L 94.62,89.98 L 47.62,89.98',
  bytedance: 'M 3.0,24.59 L 13.44,27.60 L 13.44,69.38 L 3.0,72.40 L 3.0,24.59 M 19.48,48.26 L 29.69,50.81 L 29.69,73.33 L 19.48,75.41 L 19.48,48.26 M 36.89,41.53 L 46.40,38.98 L 46.40,66.60 L 36.89,63.81 L 36.89,41.53 M 86.56,41.53 L 97.0,44.55 L 63.11,72.17 L 52.67,74.72 L 86.56,41.53',
  amazon: 'M 47.20,34.07 C 25.77,44.28 12.47,35.74 3.95,30.56 C 3.42,30.23 2.53,30.63 3.30,31.53 C 6.14,34.97 15.44,43.26 27.57,43.26 C 39.72,43.26 46.94,36.63 47.85,35.47 C 48.75,34.33 48.11,33.70 47.20,34.07 L 47.20,34.07 M 53.22,30.75 C 52.65,30.00 49.72,29.86 47.88,30.09 C 46.04,30.31 43.27,31.43 43.51,32.11 C 43.64,32.36 43.89,32.25 45.16,32.13 C 46.43,32.01 49.98,31.56 50.72,32.53 C 51.47,33.50 49.59,38.15 49.25,38.90 C 48.91,39.65 49.37,39.84 50.00,39.34 C 50.61,38.85 51.72,37.55 52.47,35.72 C 53.21,33.89 53.66,31.32 53.22,30.75 L 53.22,30.75 M 84.40,52.69 C 84.40,55.36 84.47,57.59 83.11,59.97 C 82.02,61.90 80.29,63.09 78.36,63.09 C 75.72,63.09 74.18,61.08 74.18,58.12 C 74.18,52.26 79.43,51.20 84.40,51.20 L 84.40,52.69 M 91.33,69.43 C 90.87,69.84 90.22,69.87 89.70,69.60 C 87.42,67.70 87.02,66.82 85.76,65.02 C 81.99,68.86 79.33,70.01 74.44,70.01 C 68.66,70.01 64.15,66.45 64.15,59.31 C 64.15,53.73 67.18,49.93 71.48,48.08 C 75.21,46.43 80.42,46.14 84.40,45.69 L 84.40,44.80 C 84.40,43.17 84.52,41.23 83.57,39.82 C 82.73,38.56 81.12,38.04 79.71,38.04 C 77.09,38.04 74.75,39.38 74.18,42.16 C 74.07,42.78 73.61,43.39 73.00,43.42 L 66.33,42.70 C 65.77,42.58 65.15,42.12 65.30,41.26 C 66.84,33.18 74.14,30.75 80.67,30.75 C 84.01,30.75 88.38,31.64 91.02,34.17 C 94.36,37.29 94.04,41.46 94.04,45.99 L 94.04,56.70 C 94.04,59.91 95.38,61.32 96.63,63.06 C 97.08,63.68 97.17,64.43 96.61,64.89 C 95.21,66.06 92.72,68.23 91.35,69.45 L 91.33,69.43',
  perplexity: 'M 74.80,6.65 L 50.00,31.47 L 74.80,31.47 L 74.80,6.65 L 74.80,13.44 L 74.80,6.65 M 50.0,31.47 L 25.20,6.65 L 25.20,31.47 L 50.00,31.47 L 50.0,31.47 M 49.95,3.0 L 49.95,97.0 M 74.80,56.28 L 50.00,31.46 L 50.00,67.04 L 74.80,91.85 L 74.80,56.28 L 74.80,56.28 M 25.21,56.28 L 50.00,31.46 L 50.00,67.04 L 25.21,91.85 L 25.21,56.28 L 25.21,56.28 M 14.57,31.46 L 14.57,66.89 L 25.20,66.89 L 25.20,56.28 L 50.00,31.46 L 14.57,31.46 M 50.00,31.46 L 74.79,56.28 L 74.79,66.89 L 85.43,66.89 L 85.43,31.46 L 50.00,31.46 L 50.00,31.46',
  microsoft: 'M 3.0,3.0 L 47.76,3.0 L 47.76,47.76 L 3.0,47.76 L 3.0,3.0 M 52.24,3.0 L 97.0,3.0 L 97.0,47.76 L 52.24,47.76 L 52.24,3.0 M 3.0,52.24 L 47.76,52.24 L 47.76,97.0 L 3.0,97.0 L 3.0,52.24 M 52.24,52.24 L 97.0,52.24 L 97.0,97.0 L 52.24,97.0 L 52.24,52.24',
};

const MARKS = {
  anthropic: { fill: p => p.addPath(new Path2D(LOGO.claude)) },

  openai: { fill: p => p.addPath(new Path2D(LOGO.openai)) },

  google: { fill: p => p.addPath(new Path2D(LOGO.gemini)) },

  'x-ai': { fill: p => p.addPath(new Path2D(LOGO.xai)) },

  deepseek: { fill: p => p.addPath(new Path2D(LOGO.deepseek)) },

  meta: { fill: p => p.addPath(new Path2D(LOGO.meta)) },

  mistral: { fill: p => p.addPath(new Path2D(LOGO.mistral)) },

  qwen: { fill: p => p.addPath(new Path2D(LOGO.qwen)) },

  /* Cohere has no logo on Commons, free or otherwise, so this stays the
   * hand-drawn open C. */
  cohere: { width: 20, stroke: p => {
    p.arc(50, 50, 32, Math.PI * 0.38, Math.PI * 1.62);
  } },

  'z-ai': { fill: p => p.addPath(new Path2D(LOGO.zai)) },

  /* Nvidia: the leather jacket, not the eye. The real emblem is fine at avatar
   * size but collapses into a green smear in a 22px picker row. A jacket is
   * all silhouette, which is the thing that survives being shrunk. The
   * arithmetic sets the design: at 22px one unit of this 100 box is 0.22px, so
   * a feature under roughly 8 units disappears. Hence one wide mass rather
   * than daylight between sleeve and body, a collar V opened to 24 units
   * (about 5px at picker size), and flared points that break the shoulder line
   * so it does not read as a plain torso. */
  nvidia: {
    fill: p => {
      p.moveTo(31, 27); p.lineTo(69, 27);                      // shoulders
      p.lineTo(75, 90); p.lineTo(25, 90); p.closePath();       // body, flared hem
      p.moveTo(31, 27); p.lineTo(13, 38); p.lineTo(9, 84);     // left sleeve
      p.lineTo(27, 86); p.closePath();
      p.moveTo(69, 27); p.lineTo(87, 38); p.lineTo(91, 84);    // right sleeve
      p.lineTo(73, 86); p.closePath();
      p.moveTo(33, 26); p.lineTo(22, 10); p.lineTo(52, 24); p.closePath();  // collar
      p.moveTo(67, 26); p.lineTo(78, 10); p.lineTo(48, 24); p.closePath();
    },
    knock: p => {                                              // the open front
      p.moveTo(38, 16); p.lineTo(50, 66); p.lineTo(62, 16); p.closePath();
    },
  },

  bytedance: { fill: p => p.addPath(new Path2D(LOGO.bytedance)) },

  amazon: { fill: p => p.addPath(new Path2D(LOGO.amazon)) },

  /* Perplexity's mark is line art, not a silhouette, so it is the one logo
   * here that is stroked. The source stroke scales to about 2.6 units in the
   * 100-box, which disappears in a picker row, hence the heavier weight. */
  perplexity: { width: 6, stroke: p => p.addPath(new Path2D(LOGO.perplexity)) },

  microsoft: { fill: p => p.addPath(new Path2D(LOGO.microsoft)) },
};

/** The mark for a model, or null when we only have a letter to work with. */
function markFor(model, alias) {
  const f = familyFor(model, alias);
  const m = f && MARKS[f[3]];
  if (!m) return null;
  if (!m.path) {                             // built once, reused every frame
    const p = new Path2D();
    (m.fill || m.stroke)(p);
    m.path = p;
    if (m.knock) { const k = new Path2D(); m.knock(k); m.knockPath = k; }
  }
  return m;
}
const initialFor = (model, alias) =>
  (vendorSlug(model) || alias || '?').charAt(0).toUpperCase();

/* A badge: a dark disc rimmed in the model colour with the mark, or the
 * provider's initial, on top. Written against an arbitrary context because the
 * model picker reuses it to make its row icons. Origin is the disc centre. */
function paintMark(g, mark, initial, color, size, back) {
  const r = size * 0.66;
  g.save();
  g.fillStyle = back;
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.strokeStyle = color; g.lineWidth = Math.max(1, size * 0.075);
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke();

  if (!mark) {
    g.fillStyle = color;
    g.font = `800 ${size * 0.72}px ui-monospace, Menlo, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(initial, 0, size * 0.03);
  } else {
    g.translate(-size / 2, -size / 2);
    g.scale(size / 100, size / 100);
    g.fillStyle = color; g.strokeStyle = color;
    if (mark.fill) {
      g.fill(mark.path);
      /* Knocked-out detail (the whale's eye). The disc behind is translucent,
       * so painting `back` over the mark would only tint it. Erase first, then
       * repaint the disc tone into the cleared pixels. */
      if (mark.knockPath) {
        g.save();
        g.globalCompositeOperation = 'destination-out';
        g.fill(mark.knockPath);
        g.restore();
        g.fillStyle = back;
        g.fill(mark.knockPath);
      }
    } else {
      g.lineWidth = mark.width; g.lineCap = 'round'; g.lineJoin = 'round';
      g.stroke(mark.path);
    }
  }
  g.restore();
}

function drawMark(f, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  paintMark(ctx, f.mark, f.initial, f.color, size, 'rgba(10,12,16,.82)');
  ctx.restore();
}

/* The family colour without the SPARE side effect. colorFor hands out a spare
 * on every miss, so calling it to tint a 427-row list would walk the palette
 * and change the avatars underneath. */
const familyColor = m => {
  const f = familyFor(m, '');
  return f ? f[2] : '#8b93a1';
};

/** A mark rendered to a data URL, for the picker rows. Built once per slug. */
const ICONS = {};
function markIcon(slug, px) {
  if (ICONS[slug]) return ICONS[slug];
  const dpr = 2;
  const c = document.createElement('canvas');
  c.width = px * dpr; c.height = px * dpr;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.translate(px / 2, px / 2);
  paintMark(g, markFor(slug, ''), initialFor(slug, ''), familyColor(slug), px * 0.94, 'rgba(255,255,255,.06)');
  return (ICONS[slug] = c.toDataURL());
}

const DAMAGE_MAX = 18;                 // mirrors writers_room.DAMAGE_MAX
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t;

// ------------------------------------------------------------------ state
const S = {
  fighters: [],          // fight order, drawn around the ring
  byLetter: {},
  byAlias: {},
  phase: 'idle',
  round: 0,
  effects: [],
  particles: [],
  shake: 0,
  judge: null,           // {t0, dur} while the gavel is falling
  winner: null,
  scores: null,
  running: false,
  blind: true,
  brief: '',
};

/* Preferences that outlive a run, kept in one key so there is one thing to
 * clear. localStorage is per-origin and every access can throw outright, in a
 * private window or with site data blocked, so reads and writes are both
 * guarded and a failure simply means the default. */
const PREFS = 'writers-room:prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; } };
const savePrefs = patch => { try { localStorage.setItem(PREFS, JSON.stringify({ ...loadPrefs(), ...patch })); } catch { /* nothing worth saying */ } };
const prefs = loadPrefs();

// Sound now defaults on: the blips are most of the joke, and a muted arena is
// a worse first impression than an unexpected one. Only an explicit false,
// meaning the viewer turned it off, keeps it off.
let queue = [], busyUntil = 0, speed = 1, sound = prefs.sound !== false;

/* Two rates, because they want opposite things from the slider.
 *
 * `speed` is the reading pace: the beat the pump waits between events, how
 * long a bubble holds, how long a mood or a form lasts. That is the part worth
 * stretching, since the bubble carries the line the model actually wrote and
 * at the old default the fight moved on before a fast reader had finished it.
 *
 * Motion is deliberately not that. Dragging the slider down to read the room
 * should not wade the avatars through treacle, so a lunge keeps its natural
 * snap below 1x. Above 1x it has to compress, or a 900ms lunge would outlast
 * the beat it belongs to and the fight would run its attacks over each other. */
const motion = () => Math.max(1, speed);

/* The slider is geometric rather than linear, so that 1x sits at the middle of
 * the track instead of a fifth of the way along it, and equal drags either side
 * of the middle are equal factors. Position 0..100 maps to 0.25x..4x. */
const SPEED_MIN = 0.25, SPEED_SPAN = 16;             // 0.25 * 16 = 4
const speedAt = pos => SPEED_MIN * Math.pow(SPEED_SPAN, pos / 100);
const fmtSpeed = s => (s < 1 ? s.toFixed(2).replace(/0$/, '') : s.toFixed(1)) + '\u00d7';

// ----------------------------------------------------------------- canvas
const cv = document.getElementById('arena');
const ctx = cv.getContext('2d');
let W = 0, H = 0;

function resize() {
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  W = r.width; H = r.height;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout();
}
window.addEventListener('resize', resize);

function layout() {
  const n = S.fighters.length;
  if (!n) return;
  const cx = W / 2, cy = H * 0.54;
  const rx = Math.min(W * 0.33, 320), ry = Math.min(H * 0.24, 150);
  const unit = clamp(Math.min(W / (n * 3.1), H / 7.5), 22, 52);
  S.fighters.forEach((f, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    f.hx = cx + rx * Math.cos(a);
    f.hy = cy + ry * Math.sin(a);
    f.depth = Math.sin(a);                     // front row drawn last and larger
    f.unit = unit * (0.86 + 0.2 * (f.depth + 1) / 2);
  });
  S.fighters.sort((a, b) => a.depth - b.depth);
}

// ---------------------------------------------------------------- fighters
function makeFighter(c) {
  return {
    letter: c.letter, alias: c.alias, model: c.model,
    color: colorFor(c.model, c.alias),
    mark: markFor(c.model, c.alias), initial: initialFor(c.model, c.alias),
    hp: 100, shownHp: 100, maxHp: 100,
    mood: 'idle', moodUntil: 0,
    form: 'doge', formUntil: 0,   // 'buff' | 'cheems' | 'both' while a roast lands
    lunge: null,             // {tx, ty, t0, dur, self}
    hitAt: -1e9, shakeSeed: Math.random() * 100,
    bubble: null,            // {text, until, tone}
    words: 0, draft: '', revision: '', rank: null, thinking: false,
    hx: 0, hy: 0, unit: 40, depth: 0,
  };
}

function drawFighter(f, now) {
  const u = f.unit;
  let x = f.hx, y = f.hy;

  // lunge: out fast, impact at 38%, drift home
  if (f.lunge) {
    const t = clamp((now - f.lunge.t0) / f.lunge.dur, 0, 1);
    if (now - f.lunge.t0 >= f.lunge.dur) { f.lunge = null; }
    else if (!f.lunge.self) {
      const p = t < 0.38 ? easeIn(t / 0.38) : 1 - easeOut((t - 0.38) / 0.62);
      x += (f.lunge.tx - f.hx) * 0.52 * p;
      y += (f.lunge.ty - f.hy) * 0.52 * p;
    } else {
      y -= Math.sin(Math.PI * t) * u * 0.25;   // self-roast: a little hop of shame
    }
  }

  // recoil
  const since = now - f.hitAt;
  if (since < 380) {
    const k = (1 - since / 380);
    x += Math.sin(since / 22 + f.shakeSeed) * u * 0.22 * k;
    y += Math.cos(since / 19 + f.shakeSeed) * u * 0.07 * k;
  }

  y += Math.sin(now / 620 + f.shakeSeed) * u * 0.05;        // idle bob
  const ko = f.hp <= 0;
  const flash = since < 160 ? 1 - since / 160 : 0;

  ctx.save();
  ctx.translate(x, y);

  // shadow
  ctx.globalAlpha = 0.36;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, u * 0.10, u * 0.78, u * 0.18, 0, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;

  if (ko) { ctx.rotate(-0.42); ctx.translate(-u * 0.25, 0); }

  const punch = f.lunge ? Math.sin(Math.PI * clamp((now - f.lunge.t0) / f.lunge.dur, 0, 1)) : 0;
  const mood = ko ? 'ko' : (now < f.moodUntil ? f.mood : (f.thinking ? 'think' : 'idle'));
  const form = ko ? 'doge' : formOf(f, now);

  let box;
  if (form === 'both') {
    // A self-roast is one avatar being both parties at once, which is exactly
    // the two-panel template the sprites came from. So it plays as both dogs
    // side by side on the one baseline rather than as a spliced chimera.
    const k = 0.74, dx = u * 0.50;
    ctx.save(); ctx.translate(-dx, 0);
    const bb = drawDoge(f, u * k, now, 'buff', ko, punch, false);
    drawMark(f, bb.w * SPRITES.buff.head[0], -bb.h * SPRITES.buff.head[1],
             u * k * SPRITES.buff.markR * 2);
    ctx.restore();
    ctx.save(); ctx.translate(dx, 0);
    drawDoge(f, u * k, now, 'cheems', ko, 0, false);
    ctx.restore();
    box = { w: u * 2.1, h: bb.h };
    drawTag(f, u, 0, -u * 0.26);             // one badge for the pair
  } else {
    box = drawDoge(f, u, now, form, ko, punch);
  }

  drawMoodTag(f, u, now, mood, box);
  if (flash) drawFlash(f, u, form === 'both' ? 'buff' : form, flash);

  if (S.winner === f.letter && S.phase === 'done') drawCrown(u, now);
  ctx.restore();

  drawPlate(f, x, y, u, now);
  if (f.bubble && now < f.bubble.until) drawBubble(f, x, y - u * (SPRITE_H + 0.45), now);
}

/* ------------------------------------------------------------------ sprites
 * The avatars are cut-out PNGs under static/img, loaded once and blitted with
 * drawImage. A frame that beats the network falls back to a plain blob rather
 * than throwing, and every derived variant (ko tint, impact flash) is baked
 * into an offscreen canvas once instead of being recomputed per frame.
 *
 * The per-sprite fractions below are measured off the artwork: `head` is where
 * the provider mark sits and `tag` is where the collar sits, both as a share
 * of the drawn box with the feet on the baseline.
 */
const SPRITE_H = 1.95;                        // drawn height, in fighter units
/* Two sets of anchors per slot, because the two tiers of artwork are not the
 * same shape. `head`/`markR`/`tag` are measured off the meme art an operator
 * drops in static/img. `stubAt` is measured off the shipped placeholders, whose
 * heads are a dome the size of their whole body. Fitting one set to both meant
 * one of them wore its provider mark off-centre, so the loader swaps in the
 * stub's numbers if the stub is what it ends up drawing. */
const SPRITES = {
  doge:   { src: '/static/img/doge.png',   stub: '/static/img/stub/doge.png',
            head: [ 0.13, 0.72], markR: 0.19, tag: [ 0.09, 0.13],
            stubAt: { head: [-0.002, 0.786], markR: 0.207, tag: [-0.015, 0.179] } },
  buff:   { src: '/static/img/buff.png',   stub: '/static/img/stub/buff.png',
            head: [ 0.12, 0.84], markR: 0.13, tag: [ 0.00, 0.36],
            stubAt: { head: [-0.015, 0.789], markR: 0.204, tag: [-0.022, 0.193] } },
  cheems: { src: '/static/img/cheems.png', stub: '/static/img/stub/cheems.png',
            head: [-0.09, 0.88], markR: 0.17, tag: [ 0.10, 0.24],
            stubAt: { head: [ 0.023, 0.786], markR: 0.206, tag: [ 0.066, 0.182] } },
};
let spritesReady = false;                     // every load has settled, either way
let spritesPending = 0;
for (const key of Object.keys(SPRITES)) {
  const s = SPRITES[key];
  spritesPending++;
  // Two tiers. static/img holds whatever the operator dropped in and is not
  // committed, so a fresh clone finds nothing there and falls through to the
  // plain placeholders under static/img/stub, which are ours to ship. A third
  // failure leaves s.ok false and drawBlob covers it.
  const load = (url, onFail, anchors) => {
    const im = new Image();
    im.onload = () => {
      if (im.naturalWidth > 0) {
        if (anchors) Object.assign(s, anchors);   // this artwork carries its own
        s.ok = true; s.img = im; s.tints = {}; settle();
      } else onFail();
    };
    im.onerror = onFail;
    im.src = url;
  };
  const settle = () => { if (--spritesPending === 0) spritesReady = true; };
  load(s.src, () => load(s.stub, () => { s.ok = false; settle(); }, s.stubAt));
}

/** A flat-coloured copy of a sprite, kept for the ko wash and the hit flash. */
function tintOf(s, color) {
  if (s.tints[color]) return s.tints[color];
  const c = document.createElement('canvas');
  c.width = s.img.naturalWidth; c.height = s.img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(s.img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  s.tints[color] = c;
  return c;
}

const boxOf = (s, u) => {
  const h = u * SPRITE_H;
  return { w: h * (s.img.naturalWidth / s.img.naturalHeight), h };
};

/** Draw one form with its feet on the baseline. Returns the box it filled. */
function drawDoge(f, u, now, form, ko, punch, overlays) {
  const s = SPRITES[form] || SPRITES.doge;
  ctx.save();
  if (form === 'cheems' && !ko) ctx.translate(Math.sin(now / 55) * u * 0.014, 0);
  if (punch) ctx.translate(punch * u * 0.12, -punch * u * 0.05);   // lean into it

  let box;
  if (s.ok && s.img) {
    box = boxOf(s, u);
    ctx.drawImage(s.img, -box.w / 2, -box.h, box.w, box.h);
    if (ko) {                                  // drain the colour out of a corpse
      ctx.globalAlpha = 0.62;
      ctx.drawImage(tintOf(s, '#4b5058'), -box.w / 2, -box.h, box.w, box.h);
      ctx.globalAlpha = 1;
    }
  } else {
    box = drawBlob(f, u, ko);
  }
  if (overlays !== false) drawOverlays(f, u, box, s);
  ctx.restore();
  return box;
}

/** Letter badge and provider mark, both pinned to points on the artwork. */
function drawOverlays(f, u, box, s) {
  drawTag(f, u, box.w * s.tag[0], -box.h * s.tag[1]);
  drawMark(f, box.w * s.head[0], -box.h * s.head[1], u * s.markR * 2);
}

/** The pre-sprite placeholder, and the fallback if a PNG is missing. */
function drawBlob(f, u, ko) {
  const body = ko ? '#4b5058' : f.color;
  const light = ko ? '#5b616b' : shade(f.color, 26);
  const g = ctx.createLinearGradient(0, -u * 0.9, 0, 0);
  g.addColorStop(0, light); g.addColorStop(1, body);
  ctx.fillStyle = g;
  roundRect(-u * 0.5, -u * 0.86, u, u * 0.9, u * 0.24); ctx.fill();
  ctx.fillStyle = light;
  roundRect(-u * 0.42, -u * 1.62, u * 0.84, u * 0.78, u * 0.3); ctx.fill();
  return { w: u, h: u * 1.62 };
}

/** The white-out on the frame of impact, cut to the sprite silhouette. */
function drawFlash(f, u, form, alpha) {
  const s = SPRITES[form] || SPRITES.doge;
  ctx.globalAlpha = alpha * 0.85;
  if (s.ok && s.img) {
    const box = boxOf(s, u);
    ctx.drawImage(tintOf(s, '#fff'), -box.w / 2, -box.h, box.w, box.h);
  } else {
    ctx.fillStyle = '#fff';
    roundRect(-u * 0.5, -u * 1.62, u, u * 1.62, u * 0.24); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** The letter badge, pinned to the sprite's body rather than to a fixed point. */
function drawTag(f, u, x, y) {
  const r = u * 0.19;
  ctx.fillStyle = 'rgba(8,10,14,.72)';
  circle(x, y, r); ctx.fill();
  ctx.strokeStyle = f.color; ctx.lineWidth = Math.max(1.2, u * 0.045);
  circle(x, y, r); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${u * 0.24}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(f.letter, x, y + u * 0.01);
}

/* Moods used to live on the drawn face. A cut-out sprite has a fixed
 * expression, so the mood now reads as a small tag beside the head: the
 * thinking ellipsis that the pump depends on, and a mark for the rest. */
function drawMoodTag(f, u, now, mood, box) {
  const top = -box.h;
  if (mood === 'think') {
    const n = Math.floor(now / 260) % 4;
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = i < n ? 0.95 : 0.2;
      circle(-u * 0.17 + i * u * 0.17, top - u * 0.20, u * 0.06); ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }
  if (mood === 'angry') {                       // the manga anger cross
    const x = box.w * 0.34, y = top + u * 0.16;
    ctx.strokeStyle = '#ff6a3d'; ctx.lineWidth = Math.max(1.4, u * 0.055); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - u * 0.10, y - u * 0.02); ctx.lineTo(x + u * 0.02, y - u * 0.02);
    ctx.moveTo(x - u * 0.04, y - u * 0.10); ctx.lineTo(x - u * 0.04, y + u * 0.06);
    ctx.moveTo(x + u * 0.04, y + u * 0.04); ctx.lineTo(x + u * 0.16, y + u * 0.04);
    ctx.moveTo(x + u * 0.10, y - u * 0.04); ctx.lineTo(x + u * 0.10, y + u * 0.12);
    ctx.stroke();
    return;
  }
  if (mood === 'smug') {                        // a small sparkle
    const x = box.w * 0.34, y = top + u * 0.14;
    ctx.fillStyle = '#f5c451';
    ctx.beginPath();
    ctx.moveTo(x, y - u * 0.14);
    ctx.quadraticCurveTo(x + u * 0.03, y - u * 0.03, x + u * 0.14, y);
    ctx.quadraticCurveTo(x + u * 0.03, y + u * 0.03, x, y + u * 0.14);
    ctx.quadraticCurveTo(x - u * 0.03, y + u * 0.03, x - u * 0.14, y);
    ctx.quadraticCurveTo(x - u * 0.03, y - u * 0.03, x, y - u * 0.14);
    ctx.fill();
    return;
  }
  if (mood === 'hurt' || mood === 'ko') {
    const x = box.w * 0.34, y = top + u * 0.16;
    ctx.strokeStyle = mood === 'ko' ? '#e5484d' : '#f0a14a';
    ctx.lineWidth = Math.max(1.2, u * 0.05); ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3;
      ctx.moveTo(x - Math.cos(a) * u * 0.12, y - Math.sin(a) * u * 0.12);
      ctx.lineTo(x + Math.cos(a) * u * 0.12, y + Math.sin(a) * u * 0.12);
    }
    ctx.stroke();
  }
}

function drawPlate(f, x, y, u, now) {
  const w = u * 1.9, h = 5;
  const bx = x - w / 2, by = y + u * 0.32;
  f.shownHp += (f.hp - f.shownHp) * 0.14;          // bar chases the true value

  ctx.fillStyle = 'rgba(255,255,255,.09)';
  roundRect(bx, by, w, h, 3); ctx.fill();
  const frac = clamp(f.shownHp / f.maxHp, 0, 1);
  ctx.fillStyle = frac > 0.5 ? f.color : frac > 0.22 ? '#f0a14a' : '#e5484d';
  roundRect(bx, by, w * frac, h, 3); ctx.fill();

  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = `600 ${Math.max(10, u * 0.27)}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = f.hp > 0 ? '#e8e6e1' : '#727a86';
  ctx.fillText(f.alias, x, by + 9);
  if (!S.blind) {
    ctx.font = `400 ${Math.max(8, u * 0.2)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#727a86';
    ctx.fillText(f.model, x, by + 9 + u * 0.32);
  }
}

function drawBubble(f, x, y, now) {
  const b = f.bubble;
  const fade = clamp((b.until - now) / 260, 0, 1);
  const maxW = Math.min(260, W * 0.3);
  ctx.font = '500 12.5px system-ui, sans-serif';
  const lines = wrap(b.text, maxW, 4);
  const w = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width))) + 22;
  const h = lines.length * 17 + 16;
  let bx = clamp(x - w / 2, 8, W - w - 8), by = y - h;

  ctx.globalAlpha = fade;
  ctx.fillStyle = b.tone === 'gold' ? 'rgba(60,48,18,.96)' : 'rgba(22,26,32,.96)';
  ctx.strokeStyle = b.tone === 'gold' ? '#f5c451' : f.color;
  ctx.lineWidth = 1.5;
  roundRect(bx, by, w, h, 10); ctx.fill(); ctx.stroke();
  ctx.beginPath();                                  // tail
  ctx.moveTo(clamp(x, bx + 12, bx + w - 12) - 6, by + h);
  ctx.lineTo(clamp(x, bx + 12, bx + w - 12) + 6, by + h);
  ctx.lineTo(clamp(x, bx + 14, bx + w - 10), by + h + 9);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = b.tone === 'gold' ? '#f7dfae' : '#e8e6e1';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 11, by + 9 + i * 17));
  ctx.globalAlpha = 1;
}

function drawCrown(u, now) {
  const y = -u * (SPRITE_H + 0.06) + Math.sin(now / 400) * u * 0.06;
  ctx.fillStyle = '#f5c451';
  ctx.beginPath();
  ctx.moveTo(-u * 0.3, y); ctx.lineTo(-u * 0.3, y - u * 0.26);
  ctx.lineTo(-u * 0.12, y - u * 0.1); ctx.lineTo(0, y - u * 0.34);
  ctx.lineTo(u * 0.12, y - u * 0.1); ctx.lineTo(u * 0.3, y - u * 0.26);
  ctx.lineTo(u * 0.3, y); ctx.closePath(); ctx.fill();
}

// ----------------------------------------------------------------- effects
function spark(x, y, color, big) {
  S.effects.push({ kind: 'ring', x, y, t0: performance.now(), dur: big ? 520 : 380, color, r: big ? 90 : 55 });
  const n = big ? 22 : 12;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (big ? 3.4 : 2.3) * (0.5 + Math.random());
    S.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.4, life: 1, color, size: 2 + Math.random() * 2.6 });
  }
}
function floater(x, y, text, color, size) {
  S.effects.push({ kind: 'text', x, y, t0: performance.now(), dur: 1100, text, color, size: size || 22 });
}
function confetti() {
  for (let i = 0; i < 130; i++) {
    S.particles.push({
      x: Math.random() * W, y: -20 - Math.random() * 200,
      vx: (Math.random() - .5) * 2, vy: 1 + Math.random() * 3, life: 1, decay: 0.004,
      color: SPARE[i % SPARE.length], size: 2.5 + Math.random() * 3.5, spin: true,
    });
  }
}

function drawEffects(now) {
  S.effects = S.effects.filter(e => {
    const t = clamp((now - e.t0) / e.dur, 0, 1);
    if (now - e.t0 >= e.dur) return false;
    if (e.kind === 'ring') {
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = e.color; ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(0, e.r * easeOut(t)), 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      ctx.font = `800 ${e.size}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(6,8,10,.85)';
      const y = e.y - 46 * easeOut(t);
      ctx.strokeText(e.text, e.x, y);
      ctx.fillStyle = e.color; ctx.fillText(e.text, e.x, y);
      ctx.globalAlpha = 1;
    }
    return true;
  });

  S.particles = S.particles.filter(p => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.13; p.life -= (p.decay || 0.022);
    if (p.life <= 0 || p.y > H + 40) return false;
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.fillStyle = p.color;
    if (p.spin) { ctx.fillRect(p.x, p.y, p.size, p.size * 1.9); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, p.size), 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    return true;
  });
}

function drawJudge(now) {
  if (!S.judge) return;
  const t = clamp((now - S.judge.t0) / S.judge.dur, 0, 1);
  if (now - S.judge.t0 >= S.judge.dur) { S.judge = null; return; }
  const x = W / 2, drop = easeIn(clamp(t / 0.45, 0, 1));
  const y = H * 0.1 + drop * H * 0.14;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.6 + drop * 0.6);
  ctx.fillStyle = '#f5c451';
  roundRect(-8, -44, 16, 52, 5); ctx.fill();
  roundRect(-26, -60, 52, 22, 7); ctx.fill();
  ctx.restore();
  if (t > 0.44 && !S.judge.hit) {
    S.judge.hit = true;
    spark(x, y + 14, '#f5c451', true);
    S.shake = 16; blip('ko');
  }
}

// ------------------------------------------------------------------- frame
function frame() {
  const now = performance.now();
  pump(now);

  ctx.clearRect(0, 0, W, H);

  // floor light
  const g = ctx.createRadialGradient(W / 2, H * 0.56, 10, W / 2, H * 0.56, Math.max(W, H) * 0.62);
  g.addColorStop(0, '#1a1f27'); g.addColorStop(1, '#0d0f12');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  drawFloor(now);

  ctx.save();
  if (S.shake > 0.4) {
    ctx.translate((Math.random() - .5) * S.shake, (Math.random() - .5) * S.shake);
    S.shake *= 0.86;
  }
  S.fighters.forEach(f => drawFighter(f, now));
  drawJudge(now);
  drawEffects(now);
  ctx.restore();

  requestAnimationFrame(frame);
}

function drawFloor(now) {
  if (!S.fighters.length) {
    ctx.fillStyle = '#3a414d';
    ctx.font = '500 14px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('press fight, or demo for a canned run', W / 2, H / 2);
    return;
  }
  const cx = W / 2, cy = H * 0.54;
  const rx = Math.min(W * 0.33, 320), ry = Math.min(H * 0.24, 150);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 1;
  for (const k of [1.14, 1.0, 0.72]) {
    ctx.beginPath(); ctx.ellipse(cx, cy, rx * k, ry * k, 0, 0, 7); ctx.stroke();
  }
  // The brief, centre stage. Still meant to sit behind the fight rather than
  // compete with it, but .06 was 1.14:1 against the floor, which is not quiet,
  // it is invisible. .20 is 1.81:1: legible if you look at it, ignorable if you
  // are watching the fighters, which is the whole intent.
  ctx.fillStyle = 'rgba(255,255,255,.20)';
  ctx.font = '400 12.5px "Iowan Old Style", Palatino, Georgia, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = wrap(S.brief.replace(/\s+/g, ' '), rx * 1.25, 3);
  lines.forEach((l, i) => ctx.fillText(l, cx, cy - 16 + i * 17));
  ctx.restore();
}

// ------------------------------------------------------------------- audio
let actx = null;
function blip(kind) {
  if (!sound) return;
  actx = actx || new (window.AudioContext || window.webkitAudioContext)();
  // With sound on by default the first blip can arrive without the viewer ever
  // having touched the toggle, and a context that predates a user gesture is
  // created suspended and plays nothing at all, without erroring. Resuming is
  // a no-op once it is already running.
  if (actx.state === 'suspended') actx.resume();
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.connect(g); g.connect(actx.destination);
  if (kind === 'hit')  { o.type = 'square';   o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + .12); g.gain.setValueAtTime(.14, t); }
  if (kind === 'self') { o.type = 'triangle'; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(120, t + .2); g.gain.setValueAtTime(.12, t); }
  if (kind === 'heal') { o.type = 'sine';     o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(880, t + .18); g.gain.setValueAtTime(.09, t); }
  if (kind === 'ko')   { o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(40, t + .5); g.gain.setValueAtTime(.16, t); }
  if (kind === 'parry'){ o.type = 'sine';     o.frequency.setValueAtTime(900, t); g.gain.setValueAtTime(.06, t); }
  g.gain.exponentialRampToValueAtTime(.0001, t + .55);
  o.start(t); o.stop(t + .6);
}

// -------------------------------------------------------------- event pump
function pump(now) {
  while (queue.length && now >= busyUntil) {
    const ev = queue.shift();
    let dur = 0;
    try { dur = handle(ev) || 0; } catch (err) { console.error('event failed', ev, err); }
    // A live run always runs a backlog: sixteen roasts land the moment the
    // parallel gather returns, and the fight is meant to lag behind them. Only
    // a reconnect, which replays an entire finished run, is worth rushing.
    const rush = queue.length > 30 ? clamp(queue.length / 15, 1, 6) : 1;
    busyUntil = now + dur / (speed * rush);
  }
}

function handle(ev) {
  switch (ev.type) {
    case 'reset': hardReset(); return 0;

    case 'cast': {
      S.fighters = ev.cast.map(makeFighter);
      S.byLetter = {}; S.byAlias = {};
      S.fighters.forEach(f => { S.byLetter[f.letter] = f; S.byAlias[f.alias] = f; });
      S.blind = ev.blind; S.brief = ev.brief; S.running = true;
      layout(); renderRoster(); renderBoard(); renderTexts();
      note('room', `${ev.cast.length} panelists, ${ev.rounds} round${ev.rounds === 1 ? '' : 's'}, ${ev.blind ? 'blind' : 'named'}${ev.replay ? ', replay' : ''}`);
      // the demo fixture is hand written, and says so, so the page says so too
      if (ev.fabricated) card('sys warn', 'fabricated demo', ev.fabricated, '#f5c451');
      return 400;
    }

    case 'phase': {
      S.phase = ev.phase; S.round = ev.round;
      const el = document.getElementById('phase');
      el.className = 'phase ' + ev.phase;
      el.textContent = ev.phase + (ev.round ? ' ' + ev.round : '');
      ticker(`<b>${ev.phase.toUpperCase()}${ev.round ? ' ' + ev.round : ''}</b> ${PHASE_BLURB[ev.phase] || ''}`);
      if (ev.phase === 'roast') S.fighters.forEach(f => setMood(f, 'angry', 900));
      return 900;
    }

    case 'call_start': { const f = S.byAlias[ev.alias]; if (f) f.thinking = true; return 0; }
    case 'call_end':   { const f = S.byAlias[ev.alias]; if (f) f.thinking = false; return 0; }

    case 'draft': {
      const f = S.byLetter[ev.letter];
      if (!f) return 0;
      f.draft = ev.text; f.words = ev.words; f.thinking = false;
      setMood(f, 'smug', 1200);
      floater(f.hx, f.hy - f.unit * 1.9, `${ev.words}w`, f.color, 15);
      renderTexts();
      return 260;
    }

    case 'table_talk': {
      const f = S.byAlias[ev.from];
      if (f) { f.bubble = { text: '"' + ev.text + '"', until: performance.now() + 3800 / speed, tone: 'gold' }; setMood(f, 'smug', 1400); }
      card('talk', ev.from, ev.text, f ? f.color : '#8b93a1');
      ticker(`<b>${ev.from.toUpperCase()}</b> ${esc(ev.text)}`);
      return 1700;
    }

    case 'roast': return doRoast(ev);

    case 'ranking': {
      const f = S.byAlias[ev.from];
      if (f) f.rank = ev.order;
      return 120;
    }

    case 'revision': {
      const f = S.byLetter[ev.letter];
      if (!f) return 0;
      f.revision = ev.text; f.words = ev.words; f.thinking = false;
      f.hp = clamp(f.hp + (ev.heal || 6), 0, f.maxHp);
      floater(f.hx, f.hy - f.unit * 1.7, `+${Math.round(ev.heal || 6)}`, '#4ade80', 19);
      for (let i = 0; i < 9; i++) {
        S.particles.push({ x: f.hx + (Math.random() - .5) * f.unit, y: f.hy, vx: (Math.random() - .5) * .7, vy: -1.7 - Math.random(), life: 1, color: '#4ade80', size: 2 + Math.random() * 2 });
      }
      setMood(f, 'idle', 800); blip('heal'); renderTexts(); renderBoard();
      return 480;
    }

    case 'verdict': {
      S.judge = { t0: performance.now(), dur: 1600 };
      card('sys', 'the judge rules', ev.text, '#f5c451');
      ticker(`<b>VERDICT</b> ${esc(ev.order.join(' > '))}`);
      // damage comes from the server, weighted to match the judge's Borda share.
      // Inventing a figure here is what put the health bars out of order once.
      ev.order.forEach((l, i) => {
        const f = S.byLetter[l];
        const d = ev.damage ? (ev.damage[l] || 0) : i * 4;
        if (!f || d <= 0) return;
        f.hp = clamp(f.hp - d, 0, f.maxHp);
        setTimeout(() => {
          f.hitAt = performance.now();
          spark(f.hx, f.hy - f.unit * 0.7, '#f5c451', d > 20);
          floater(f.hx, f.hy - f.unit * 1.2, '-' + Math.round(d), '#f5c451', d > 20 ? 26 : 20);
          setMood(f, 'hurt', 900);
          renderBoard();
        }, 700 + i * 120);
      });
      return 2200;
    }

    case 'scores': {
      S.scores = ev.scores; S.winner = ev.winner;
      renderBoard();
      const f = S.byLetter[ev.winner];
      if (f) {
        setMood(f, 'smug', 99999);
        f.bubble = { text: S.blind ? `${f.alias} takes it.` : `${f.alias} wins.`, until: performance.now() + 8000 / speed, tone: 'gold' };
        confetti();
      }
      return 700;
    }

    case 'cost': {
      document.getElementById('cost').textContent = '$' + Number(ev.cost || 0).toFixed(4);
      document.getElementById('calls').textContent = `${ev.calls} calls`;
      return 0;
    }

    case 'done': {
      S.phase = 'done'; S.running = false;
      const el = document.getElementById('phase');
      el.className = 'phase done'; el.textContent = 'done';
      setRunning(false);
      note('done', ev.out_dir === '(replay)' ? 'replay finished' : `transcript written to ${ev.out_dir}`);
      return 0;
    }

    case 'error': {
      S.running = false; setRunning(false);
      card('sys', 'error', ev.message, '#ff6a3d');
      status(ev.message, true);
      return 0;
    }
  }
  return 0;
}

const PHASE_BLURB = {
  unlock: 'fetching the OpenRouter credential from 1Password.',
  draft: 'every panelist answers the same brief in its own voice.',
  roast: 'drafts are dealt out and the panel goes to work.',
  revise: 'everyone rewrites against what was said about them.',
  verdict: 'the judge ranks the revisions.',
};

function doRoast(ev) {
  const from = S.byAlias[ev.from], target = S.byLetter[ev.target];
  const now = performance.now();
  const dmg = ev.damage || 0;
  const parried = dmg < 1;

  if (from) {
    setMood(from, 'angry', 1400);
    // The roaster swells for the length of the lunge. A self-roast is the
    // attacker and the victim at once, so it goes half and half instead.
    setForm(from, ev.self_roast ? 'both' : 'buff', 2400);
    from.lunge = target ? { tx: target.hx, ty: target.hy, t0: now, dur: 900 / motion(), self: ev.self_roast } : null;
    from.bubble = { text: pull(ev.text), until: now + 4200 / speed, tone: ev.self_roast ? 'gold' : 'plain' };
  }

  const hitDelay = 340 / motion();
  setTimeout(() => {
    if (!target) return;
    target.hitAt = performance.now();
    target.hp = clamp(target.hp - dmg, 0, target.maxHp);
    if (parried) {
      spark(target.hx, target.hy - target.unit * 0.7, '#7dd3fc', false);
      floater(target.hx, target.hy - target.unit * 1.2, 'PARRIED', '#7dd3fc', 15);
      blip('parry');
    } else {
      // a self-roast puts the bubble and the damage on the same avatar, so the
      // number steps aside rather than landing on the words
      const off = ev.self_roast ? target.unit * 1.5 : 0;
      spark(target.hx, target.hy - target.unit * 0.7, ev.self_roast ? '#f5c451' : '#ff6a3d', dmg > 12);
      floater(target.hx + off, target.hy - target.unit * 1.2, '-' + Math.round(dmg), ev.self_roast ? '#f5c451' : '#ff6a3d', dmg > 12 ? 26 : 20);
      if (ev.self_roast) floater(target.hx + off, target.hy - target.unit * 1.75, 'SELF', '#f5c451', 14);
      setMood(target, 'hurt', 1000);
      // Only a landed hit produces tears. A parry leaves the target composed,
      // and a self-roast is already showing both halves on the one avatar.
      if (!ev.self_roast) setForm(target, 'cheems', 2000);
      S.shake = Math.max(S.shake, dmg > 12 ? 11 : 5);
      blip(ev.self_roast ? 'self' : 'hit');
      if (target.hp <= 0) { floater(target.hx, target.hy - target.unit * 2.6, 'K.O.', '#e5484d', 28); blip('ko'); }
    }
    renderBoard();
  }, hitDelay);

  card(ev.self_roast ? 'self' : '', `${ev.from} on ${ev.target}${S.blind ? '' : ' = ' + ev.target_alias}`,
       ev.text, from ? from.color : '#8b93a1', parried ? 'parried' : '-' + Math.round(dmg), ev.tic);
  ticker(`<b>${ev.from.toUpperCase()} &rarr; ${ev.target}</b> ${esc(pull(ev.text))}`);
  // A median pull off the fixture is ten words, which a 300wpm reader clears in
  // about two seconds. The beat is set there on purpose: fast enough that the
  // fight still reads as a fight, slow enough to take the line in.
  return 2000;
}

function setMood(f, mood, ms) { f.mood = mood; f.moodUntil = performance.now() + ms / speed; }

/** Buff, cheems or both. Reverts by expiry, the same way a mood does. */
function setForm(f, form, ms) { f.form = form; f.formUntil = performance.now() + ms / speed; }
const formOf = (f, now) => (f.form && now < f.formUntil) ? f.form : 'doge';

/** First quotable sentence, for the speech bubble. */
function pull(text) {
  const t = plain(text);
  const q = t.match(/"([^"]{18,140})"/);           // a quoted phrase beats a lead sentence
  if (q) return '"' + q[1] + '"';
  const m = t.match(/^(.{40,150}?[.!?])\s/);
  return m ? m[1] : t.slice(0, 130) + (t.length > 130 ? '...' : '');
}

// -------------------------------------------------------------------- side
const feed = document.getElementById('feed');

function card(cls, who, body, color, dmg, tic) {
  const el = document.createElement('div');
  el.className = 'card ' + (cls || '');
  el.style.setProperty('--c', color || '#8b93a1');
  el.innerHTML =
    `<h4><span class="who">${esc(who)}</span>${dmg ? `<span class="dmg">${esc(dmg)}</span>` : ''}</h4>` +
    `<div class="md">${md(body)}</div>` + (tic ? `<div class="tic">tic: ${esc(tic)}</div>` : '');
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
  while (feed.children.length > 300) feed.removeChild(feed.firstChild);
}
const note = (who, body) => card('sys', who, body, '#8b93a1');
const ticker = html => { document.getElementById('ticker').innerHTML = html; };

function renderBoard() {
  const rows = S.fighters.slice().sort((a, b) =>
    (S.scores ? (S.scores[b.letter] || 0) - (S.scores[a.letter] || 0) : b.hp - a.hp));
  document.getElementById('board').innerHTML =
    `<table class="board"><tr><th></th><th>panelist</th><th class="n">hp</th><th class="n">borda</th></tr>` +
    rows.map(f => `<tr class="${S.winner === f.letter ? 'win' : ''}">
        <td style="color:${f.color}">${f.letter}</td>
        <td>${esc(f.alias)}<br><span style="color:#5c6473;font-size:10px">${esc(f.model)}</span></td>
        <td class="n">${Math.round(f.hp)}</td>
        <td class="n">${S.scores ? (S.scores[f.letter] ?? 0).toFixed(1) : '.'}</td></tr>`).join('') +
    `</table><p style="font:400 11px/1.5 var(--mono);color:#5c6473;margin-top:12px">
       hp is a monotone transform of the Borda count, so the cartoon and the arithmetic agree.
       A critic's top-ranked draft takes no damage and its last-ranked takes ${DAMAGE_MAX} on the chin.
       The judge hits harder in the same proportion as its heavier Borda weight.</p>`;
}

function renderTexts() {
  document.getElementById('text').innerHTML = S.fighters.map(f => `
    <div class="textblock" style="--c:${f.color}">
      <h3>Writer ${f.letter} = ${esc(f.alias)}</h3>
      <div class="meta">${esc(f.model)} &middot; ${f.words} words &middot; ${f.revision ? 'revised' : 'draft'}</div>
      <div class="body md">${md(f.revision || f.draft || '(waiting)')}</div>
    </div>`).join('') || '<p style="color:#5c6473">No run yet.</p>';
}

// ------------------------------------------------------------------ setup
let ROOMS = [], roster = [];

function renderRoster() {
  const el = document.getElementById('roster');
  el.innerHTML = roster.map((m, i) =>
    `<span class="chip" style="--c:${familyColor(m)}"><i class="dot"></i>${esc(m)}<button data-i="${i}">&times;</button></span>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { roster.splice(+b.dataset.i, 1); renderRoster(); });
}

async function boot() {
  const r = await (await fetch('/api/rooms')).json();
  ROOMS = r.rooms;
  const sel = document.getElementById('room');
  sel.innerHTML = ROOMS.map(x => `<option value="${x.file}">${esc(x.name)}</option>`).join('');
  document.getElementById('replay').innerHTML =
    '<option value="">a past run</option>' + r.runs.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  sel.onchange = pickRoom;
  pickRoom();
  if (!r.have_key) status('No OPENROUTER_API_KEY found. Demo still works.', true);
}

/** Size the brief box to its content, so the abstract room is readable on load
 *  rather than a three line slot with a scrollbar. Capped, and skipped once the
 *  user has dragged the grip, since their size beats ours. */
function fitBrief() {
  const ta = document.getElementById('brief');
  if (ta.dataset.userSized) return;
  ta.style.height = 'auto';
  ta.style.height = clamp(ta.scrollHeight + 4, 96, window.innerHeight * 0.42) + 'px';
}

function pickRoom() {
  const room = ROOMS.find(x => x.file === document.getElementById('room').value);
  if (!room) return;
  document.getElementById('brief').value = room.brief;
  fitBrief();
  document.getElementById('rounds').value = room.rounds;
  document.getElementById('judge').value = room.judge || '';
  document.getElementById('blind').checked = room.blind !== false;
  roster = room.panelists.map(p => p.model);
  renderRoster();
}

const status = (msg, err) => {
  const el = document.getElementById('status');
  el.textContent = msg || ''; el.className = err ? 'err' : '';
};

function setRunning(on) {
  document.getElementById('start').disabled = on;
  document.getElementById('demo').disabled = on;
  document.getElementById('stop').disabled = !on;
  if (on) document.getElementById('setup').classList.remove('open');
}

function hardReset() {
  S.fighters = []; S.byLetter = {}; S.byAlias = {};
  S.effects = []; S.particles = []; S.scores = null; S.winner = null;
  S.judge = null; S.shake = 0; S.phase = 'idle';
  feed.innerHTML = ''; ticker(''); renderBoard(); renderTexts();
  document.getElementById('cost').textContent = '$0.0000';
  document.getElementById('calls').textContent = '0 calls';
}

async function post(body) {
  status('starting...');
  queue = []; busyUntil = 0;
  const res = await fetch('/api/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { status(j.error || 'failed to start', true); return; }
  status(''); setRunning(true);
}

document.getElementById('start').onclick = () => post({
  room: document.getElementById('room').value,
  brief: document.getElementById('brief').value,
  models: roster,
  rounds: +document.getElementById('rounds').value,
  blind: document.getElementById('blind').checked,
  exclude_self: document.getElementById('exclude').checked,
  judge: document.getElementById('judge').value.trim(),
  seed: document.getElementById('seed').value,
});
document.getElementById('demo').onclick = () => post({ demo: true });
document.getElementById('stop').onclick = () => fetch('/api/stop', { method: 'POST' });
document.getElementById('replay').onchange = e => { if (e.target.value) post({ replay: e.target.value }); };
document.getElementById('setup-toggle').onclick = () => {
  document.getElementById('setup').classList.toggle('open');
  fitBrief();
};

// Drag the top grip. Up is taller, because the panel is bottom anchored and
// the box grows upward.
(() => {
  const grip = document.getElementById('brief-grip');
  const ta = document.getElementById('brief');
  let startY = 0, startH = 0;
  const move = e => {
    ta.style.height = clamp(startH + (startY - e.clientY), 72, window.innerHeight * 0.62) + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    ta.dataset.userSized = '1';
    startY = e.clientY;
    startH = ta.getBoundingClientRect().height;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => {          // back to fitting the text
    delete ta.dataset.userSized;
    fitBrief();
  });
})();

/* --------------------------------------------------------------- model picker
 * OpenRouter serves several hundred models, so the list filters as you type
 * and only the first PICK_MAX matches are put in the DOM. Rows carry the same
 * provider mark the avatars wear, so the picker and the ring agree.
 *
 * One factory, two instances: the panel adder appends to the roster, the judge
 * replaces a single value and offers "no judge" at the top. The catalogue is
 * fetched once and shared.
 */
const PICK_MAX = 60;
let CATALOGUE = null, loading = false;
const pickers = [];

const money = v => (v == null ? '?' : v >= 1 ? '$' + v.toFixed(2) : '$' + v.toFixed(3));

async function loadCatalogue() {
  if (CATALOGUE || loading) return;
  loading = true;
  try {
    const r = await (await fetch('/api/models')).json();
    CATALOGUE = r.models || [];
  } catch (err) {
    CATALOGUE = [];
    console.error('model list failed', err);
  }
  loading = false;
  pickers.forEach(p => p.refreshIfOpen());
}

/**
 * @param input   the combobox input
 * @param menu    the listbox container
 * @param onPick  called with the chosen id, '' when the none row is taken
 * @param extras  rows offered above the catalogue, e.g. the judge's none row
 */
function makePicker(input, menu, onPick, extras = []) {
  let rows = [], at = -1;

  const filter = q => {
    if (!CATALOGUE) { loadCatalogue(); render(0); return; }
    const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hit = m => terms.every(t =>
      m.id.toLowerCase().includes(t) || (m.name || '').toLowerCase().includes(t));
    const all = terms.length ? CATALOGUE.filter(hit) : CATALOGUE;
    rows = extras.concat(all.slice(0, PICK_MAX));
    at = rows.length ? 0 : -1;
    render(all.length + extras.length);
  };

  const render = total => {
    if (!rows.length) {
      menu.innerHTML = `<div class="mnone">${CATALOGUE ? 'nothing matches' : 'loading the catalogue'}</div>`;
    } else {
      menu.innerHTML = rows.map((m, i) => (m.none ? `
        <div class="mrow mnoneopt${i === at ? ' on' : ''}" role="option" data-i="${i}"
             aria-selected="${i === at}">
          <span class="mk"></span>
          <span class="mname">${esc(m.short)}<em>${esc(m.vendor)}</em></span>
          <span class="mid"></span><span class="mpx"></span>
        </div>` : `
        <div class="mrow${i === at ? ' on' : ''}" role="option" data-i="${i}"
             aria-selected="${i === at}">
          <img class="mk" src="${markIcon(m.slug || m.id.split('/')[0], 22)}" alt="">
          <span class="mname">${esc(m.short || m.name || m.id)}
            <em>${esc(m.vendor || '')}</em></span>
          <span class="mid">${esc(m.id)}</span>
          <span class="mpx">${money(m.price_in)} in<br>${money(m.price_out)} out</span>
        </div>`)).join('') +
        (total > rows.length
          ? `<div class="mnone">${total - rows.length} more, keep typing</div>` : '');
    }
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const close = () => {
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };

  const take = id => { onPick(String(id ?? '').trim()); close(); };

  menu.addEventListener('mousedown', e => {         // before the input blurs
    const row = e.target.closest('.mrow');
    if (!row) return;
    e.preventDefault();
    take(rows[+row.dataset.i].id);
  });
  input.addEventListener('focus', () => { loadCatalogue(); filter(input.value); });
  input.addEventListener('input', () => filter(input.value));
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    const open = !menu.hidden && rows.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      at = (at + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
      render(rows.length);
      const on = menu.querySelector('.mrow.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      // a highlighted row wins, otherwise take whatever was typed as a raw id
      take(open && at >= 0 ? rows[at].id : input.value);
    }
  });

  const api = { refreshIfOpen: () => { if (document.activeElement === input) filter(input.value); } };
  pickers.push(api);
  return api;
}

const mInput = document.getElementById('model-input');
makePicker(mInput, document.getElementById('model-menu'), id => {
  if (id && !roster.includes(id)) { roster.push(id); renderRoster(); }
  mInput.value = '';
});

const jInput = document.getElementById('judge');
makePicker(jInput, document.getElementById('judge-menu'), id => { jInput.value = id; },
           [{ id: '', none: true, short: 'no judge',
              vendor: 'scored on the panel ballots alone' }]);

document.getElementById('add-model').onclick = () => {
  const v = mInput.value.trim();
  if (v && !roster.includes(v)) { roster.push(v); renderRoster(); }
  mInput.value = '';
};

const speedEl = document.getElementById('speed'), speedOut = document.getElementById('speed-out');
if (Number.isFinite(prefs.pace)) speedEl.value = String(clamp(prefs.pace, 0, 100));
speedEl.oninput = () => {
  speed = speedAt(+speedEl.value);
  speedOut.textContent = fmtSpeed(speed);
  speedEl.setAttribute('aria-valuetext', fmtSpeed(speed).replace('\u00d7', ' times'));
};
// oninput drives the fight, onchange records it: saving on every pixel of a
// drag would write to disk a hundred times to land on one number.
speedEl.onchange = () => savePrefs({ pace: +speedEl.value });
speedEl.oninput();
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.pane').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); document.getElementById(b.dataset.tab).classList.add('on');
});
const soundEl = document.getElementById('sound');
const paintSound = () => {
  soundEl.textContent = sound ? '🔊' : '🔇';
  soundEl.setAttribute('aria-pressed', String(sound));
};
soundEl.onclick = () => {
  sound = !sound;
  paintSound();
  savePrefs({ sound });
  if (sound) blip('parry');
};
paintSound();                                   // the markup cannot know the saved value

// click a fighter to read what it actually wrote
cv.addEventListener('click', e => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const hit = S.fighters.slice().reverse().find(f =>
    Math.abs(x - f.hx) < f.unit * 0.85 && y > f.hy - f.unit * (SPRITE_H + 0.1) && y < f.hy + f.unit * 0.6);
  if (!hit) return;
  document.getElementById('drawer-body').innerHTML = `
    <h2 style="font:600 18px var(--mono);color:${hit.color};margin:0 0 4px">Writer ${hit.letter} = ${esc(hit.alias)}</h2>
    <div style="font:400 11px var(--mono);color:#5c6473;margin-bottom:18px">${esc(hit.model)} &middot; hp ${Math.round(hit.hp)}</div>
    ${hit.revision ? `<h3 style="font:600 11px var(--mono);color:#8b93a1;letter-spacing:.1em">REVISION</h3>
      <div style="font:400 15px/1.65 var(--serif);white-space:pre-wrap;margin-bottom:24px">${esc(hit.revision)}</div>` : ''}
    <h3 style="font:600 11px var(--mono);color:#8b93a1;letter-spacing:.1em">DRAFT</h3>
    <div style="font:400 15px/1.65 var(--serif);white-space:pre-wrap;color:#b9b6b0">${esc(hit.draft || '(nothing yet)')}</div>`;
  document.getElementById('drawer').hidden = false;
});
document.getElementById('drawer-close').onclick = () => document.getElementById('drawer').hidden = true;
document.getElementById('drawer').onclick = e => { if (e.target.id === 'drawer') e.currentTarget.hidden = true; };

// ------------------------------------------------------------------- utils
function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); };
const arc = (x, y, r, a, b) => { ctx.beginPath(); ctx.arc(x, y, r, a, b); ctx.stroke(); };
const arcStroke = arc;

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => clamp(c + amt, 0, 255);
  return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(c => c.toString(16).padStart(2, '0')).join('');
}
function wrap(text, maxW, maxLines) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.length) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxW - 12) lines[maxLines - 1] = last.slice(0, -3) + '...';
  }
  return lines;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* A small markdown subset, because the models write markdown and the page was
 * printing it raw: the judge's verdict arrived on screen as a literal
 * "## Verdict" and "*Journal of Financial Economics*". This was never specific
 * to the judge or to a model. Nothing here had ever rendered markdown; the
 * verdict is only where you notice, because it is the text most likely to
 * carry a heading.
 *
 * Hand written for the same reason the provider marks are drawn rather than
 * fetched: the page has to work offline and the repo ships nothing third party.
 *
 * Everything is escaped before a single rule runs, and every rule works on the
 * escaped text, so the output can only contain tags this code itself emits.
 * Model output is not trusted input. A draft containing a script tag is a draft
 * that talks about a script tag. */
const MD_URL = /^(https?:\/\/|mailto:|\/)/i;        // anything else is left as text
const MD_HOLD = '\uE000';                           // private use, so it cannot occur in prose

function mdInline(s) {
  const code = [];                                  // held aside so no rule runs inside them
  s = s.replace(/`([^`]+)`/g, (_, c) => MD_HOLD + (code.push(c) - 1) + MD_HOLD);
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, href) =>
    MD_URL.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : m);
  // TIGHT is "opens and closes on a non-space", so arithmetic like 2 * 3 * 4
  // is left alone. Written out rather than using a lookbehind, which Safari
  // only learned in 16.4.
  const TIGHT = '([^\\s*_](?:[^\\n]*?[^\\s*_])?)';
  const em = (d, tag) => new RegExp('(^|[^\\w*_])' + d + TIGHT + d + '(?![\\w*_])', 'g');
  s = s.replace(em('\\*\\*\\*', 0), '$1<strong><em>$2</em></strong>')
       .replace(em('\\*\\*', 0), '$1<strong>$2</strong>')
       .replace(em('\\*', 0), '$1<em>$2</em>')
       .replace(em('__', 0), '$1<strong>$2</strong>')
       .replace(em('_', 0), '$1<em>$2</em>')
       .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s.replace(new RegExp(MD_HOLD + '(\\d+)' + MD_HOLD, 'g'), (_, i) => `<code>${code[+i]}</code>`);
}

/** Markdown to HTML. Escapes once, here, then parses the escaped lines. */
const md = src => mdBlocks(esc(String(src == null ? '' : src)).split(/\r?\n/));

function mdBlocks(lines) {
  const out = [], para = [];
  const flush = () => { if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para.length = 0; } };
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^\s{0,3}(```|~~~)/);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;                                          // the closing fence, if the model wrote one
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    if (!line.trim()) { flush(); i++; continue; }

    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { flush(); out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); i++; continue; }

    if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }

    // The escape pass has already turned a quote marker into &gt;, so that is
    // what the rule has to look for. Matching a bare > here silently never fired.
    if (/^\s{0,3}&gt;/.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && /^\s{0,3}&gt;/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}&gt;\s?/, ''));
      out.push(`<blockquote>${mdBlocks(body)}</blockquote>`);
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+/.test(line);
    if (ordered || /^\s*[-*+]\s+/.test(line)) {
      flush();
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(re);
        if (m) { items.push(m[1]); i++; continue; }
        // a wrapped line under the last bullet belongs to it, but a blank line
        // or the start of any other block ends the list
        if (items.length && lines[i].trim() && !/^\s{0,3}(#{1,6}\s|```|~~~)/.test(lines[i])
            && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) && !/^\s{0,3}&gt;/.test(lines[i])) {
          items[items.length - 1] += ' ' + lines[i].trim(); i++; continue;
        }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(x => `<li>${mdInline(x)}</li>`).join('')}</${tag}>`);
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('');
}

/** The same subset flattened to one line of plain text, for the canvas, which
 *  cannot draw a heading and should not be drawing asterisks either. */
function plain(s) {
  return String(s == null ? '' : s)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]\n]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}([-*_])\s*(\1\s*){2,}$/gm, ' ')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w_])__([^_\n]+)__(?![\w_])/g, '$1$2')
    .replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1$2')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

// --------------------------------------------------------------------- go
const es = new EventSource('/api/events');
es.onmessage = e => { queue.push(JSON.parse(e.data)); };
es.onerror = () => status('lost the event stream, retrying', true);
es.onopen = () => status('');

resize();
renderBoard(); renderTexts();
boot();
requestAnimationFrame(frame);
