# ai-writers-room

(BTW, I'm aware that this is very silly. Blame [this tweet](
https://x.com/korenmiklos/status/2095253475508519108) which came in right
before the weekly reset on my Claude subscription. Got to burn that token
allocation on something.)

Several models get the same brief, write it in their native voice, then read
each other's drafts anonymously and tear them apart. Everyone revises against
the roasts, and an optional judge ranks the results without knowing who wrote
what. One OpenRouter key pays for all of it.

There are two front ends. `writers_room.py` runs a room in the terminal and
writes a transcript. `arena.py` serves the same run to a browser as a fight,
with the panelists as avatars that lunge at whichever draft they are currently
tearing apart.

## Why there is no framework here

The run is a fixed pipeline over stateless completions: draft, roast, revise,
verdict. LangGraph, CrewAI and AutoGen all buy you a scheduler and an agent
abstraction that this does not need, at the cost of hiding the prompts behind
their own conventions. The prompts are the experiment, so they stay in one
readable file: `writers_room.py`, about 400 lines of `asyncio` plus `httpx`
against OpenRouter's OpenAI-compatible endpoint.

The browser front end is the same refusal one layer up: `arena.py` is Starlette
plus one SSE endpoint, and the page is three static files with no build step,
no bundler and no framework. The engine gained one optional argument for it,
`run_room(..., emit=callback)`, and nothing else.

## Setup

You need an OpenRouter key, which is what pays for every model on the panel.

```
cp .env.example .env
# uncomment one key line and paste your key from https://openrouter.ai/keys
# there, giving it a spend limit while you are on that page
chmod 600 .env
uv run writers_room.py key      # confirms it resolves, prints only a mask
```

`.env` is gitignored. `OPENROUTER_API_KEY` in the environment works too and
takes precedence. If you keep secrets in a manager, the value may be a
reference instead of a key: 1Password's `op://` scheme is resolved at startup
without any extra setup. See SECURITY.md for that and for the rest of the
picture.

No virtualenv to place: the scripts carry PEP 723 headers and `uv run`
resolves their dependencies.

## What it costs

Every panelist writes a draft, reviews every other draft, and rewrites its own,
so the token count grows with roughly the square of the panel size. Measured on
real runs: five cheap models on one round came to about two cents, and six
frontier models with a judge came to about thirty. The page shows the running
total, and a spend limit on the key is the reliable way to bound it.

## Use

```
uv run writers_room.py run rooms/claudese.yaml
uv run writers_room.py run rooms/abstract.yaml --brief @draft/abstract.txt
uv run writers_room.py run rooms/claudese.yaml --rounds 2 --exclude-self
uv run writers_room.py run rooms/claudese.yaml --no-blind   # rivals, named
uv run writers_room.py run rooms/claudese.yaml --models anthropic/claude-opus-5,x-ai/grok-4.6
uv run writers_room.py models gemini          # what OpenRouter currently serves
```

Each run writes `runs/<timestamp>-<room>/transcript.md` (the readable thing)
and `raw.json` (every prompt result, for analysis).

## The arena

```
uv run arena.py                 # opens http://127.0.0.1:8770
uv run arena.py --port 9000 --no-open
```

Configure the panel at the bottom of the page and press **fight**. Press
**demo** to replay a canned run with no key and no spend, which is the fastest
way to see what the thing does. Past runs under `runs/` are replayable from the
same control.

**The demo transcript is fabricated.** It was written by hand as a fixture. No
model produced any of it, and the drafts, roasts, rankings, timestamp and cost
are all invented. The model names label its four seats, and nothing in it is
evidence about any real model. The file says so in its first key, so the
disclaimer travels with the data, and the page prints the same warning when the
demo runs.

What is on screen:

- Each panelist is an avatar with a letter badge, the same letter the models see.
  Health is 100 to start.
- A roast is a lunge and a hit. Damage is the roaster's own ranking of that
  draft: whatever it ranked first takes nothing and is shown as `PARRIED`,
  whatever it ranked last takes the full 18. **Health is therefore a monotone
  transform of the Borda score**, deliberately, so the cartoon cannot end up
  disagreeing with the scoreboard. Both orderings are shown side by side.
- A self-roast is gold, labelled `SELF`, and the avatar hits itself.
- Revision is a heal. The judge's verdict is a gavel and a finishing blow.
- Click any avatar to read its actual draft and revision. The right-hand panel
  carries the full text of every roast as it lands, which is the part worth
  reading.
- Speech bubbles prefer a phrase the critic quoted, on the theory that the
  quotation is the joke.

Two clocks are in play. Models answer in bursts, since roasts are gathered in
parallel, so events land in a queue and drain one beat at a time rather than all
at once. A browser that connects mid-run, or reloads, is caught up from the
event history at speed instead of being shown a blank ring.

The pace slider covers the rest. It stretches the reading time, meaning the
beat between events and how long a speech bubble holds, and below 1x it leaves
the lunges alone on purpose: slowing the fight down to read it should not put
the avatars in slow motion. Above 1x the motion has to compress too, or a lunge
would outlast the beat it belongs to. The default is set against the length of
an actual pull quote, at a pace a fast reader clears and a slow one does not,
on the grounds that the full text is in the feed beside the ring anyway.

## Rooms

`abstract.yaml` is the default and is what the browser opens on. It points the
panel at the abstract of Jensen and Meckling (1976), on the theory that setting
a room of hostile referees on the most recognisable abstract in modern finance
beats inventing a brief nobody has read. The default is chosen by `default: true`
in the room file, not by which filename happens to sort first.

`claudese.yaml`, `east-west.yaml` and `weight-class.yaml` deliberately share one
brief, so that the only thing that varies between them is who is on the panel.
claudese is five frontier models in their native register. east-west splits six
between labs trained in the US and in China, to see whether house style clusters
by training culture. weight-class puts three of the current frontier flagships
against three of the cheap seats, ending at a 1B model, which is less about who
wins than about what the roast phase does with a gap that wide. It is also much
the most expensive room: six panelists and a judge, two of them billing at $50
per Mtok of output, works out around eighty cents a run rather than the thirty
cents above.

In every room the judge sits outside every family on the panel. Blind mode
already hides the names, but a Claude model ranking a room containing another
Claude model is one house marking its own homework, and that is cheaper to
remove than to argue about.

A room whose model cannot return a parseable ballot is not a broken run. That
panelist abstains, contributing no Borda and dealing no damage, while still
being read and ranked by everyone else, and `judge_weight` counts the ballots
actually cast rather than the nominal panel size. weight-class exists partly to
exercise that path.


A room is a YAML file. Everything except `brief` and `panelists` has a default.

| key | meaning |
|---|---|
| `brief` | the writing task all panelists receive |
| `panelists` | list of `{model, alias, persona, temperature}` |
| `draft_system` | system prompt for the drafting phase. Keep it thin: a fat one launders away the native voice, which is what you are trying to observe |
| `critic_prompt` | the roasting persona shared by the panel |
| `house_style` | appended to the draft and revise system prompts when you do want constraints |
| `rounds` | roast-and-revise cycles. 2 is where models start converging on the same flattened voice, which is itself the interesting result |
| `judge` | model id for the final blind ranking, or null |
| `blind` | true (default) hides authorship behind letters. False labels every draft with the model that wrote it, which turns style criticism into score-settling |
| `exclude_self` | true hides a panelist's own draft from its packet. Default false, because the self-roasts are the best part |
| `seed` | fixes the draft-to-letter assignment so runs are comparable |

## Design notes

- **Anonymity is load-bearing, so it is the default.** Drafts are shuffled into
  letters A, B, C by a seeded RNG, and no model is told which is its own. A model
  that knows it is reading itself pulls the punch. The transcript labels
  self-roasts after the fact so you can find them.
- **`blind: false` runs the other experiment.** Each draft is labelled with the
  model that wrote it, and each panelist is told which draft is its own and that
  the rest are rivals. This is the version in the tweet that prompted all of
  this: models put each other in their place by name, and you get reputation
  priors rather than reactions to prose. Run both and diff them. Letters remain
  the routing key underneath either way, so critique still reaches the right
  author and the scoreboard is comparable across modes.
- **Roasts are requested as JSON** so critique can be routed back to the right
  author for revision. Parsing is lenient: fenced block first, then the first
  balanced object. If a model refuses to comply, its whole reply is passed to
  every author verbatim rather than dropped, and the transcript prints it raw.
- **Scoring is Borda** over every roaster's ranking across all rounds, with the
  judge weighted as half the panel. It is a sanity check, not a measurement:
  with five panelists and one round the standard error swamps most gaps.
- **Cost** is read from OpenRouter's `usage.include` field and printed per run.
  A five-model, one-round `claudese` run is a few cents.
- Failures degrade rather than abort. Four retries with exponential backoff on
  429 and 5xx, then a placeholder that keeps the rest of the room running.

## Running it safely

The server binds `127.0.0.1`. It has no login, and anything that can reach it
can start a run against your key, so a non-loopback `--host` is refused unless
you also pass `--allow-remote`. If you use that, put it behind something that
asks for a password.

## Tests

```
uv run tests/test_offline.py
uv run tests/test_events.py
```

Both stub the transport. No API calls, no spend. The first exercises the four
phases, the JSON fallback path, ranking parsing and transcript rendering. The
second pins the event contract: that a live run and a replay emit the same
vocabulary, that every call is opened and closed so no avatar is left thinking
forever, that damage and Borda agree on the ordering, that a broken run reaches
the page as an event rather than a stack trace, and that the browser has a
handler for every event the server can send and sends every event the browser
handles.
