#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27", "pyyaml>=6", "rich>=13"]
# ///
"""Writers' room: several models draft, ruthlessly mock each other, then revise.

Phases per run:
  1. DRAFT    every panelist answers the brief, in parallel, with a near-empty
              system prompt so its native voice shows through.
  2. ROAST    every panelist reads all drafts under anonymous letters and
              savages them, then ranks.
  3. REVISE   every panelist reads the roasts of its own draft and rewrites.
  4. VERDICT  an optional judge model ranks the revisions, still blind.

Anonymity is the point. A model that does not know which draft is its own has
no incentive to go easy, and self-roasts are the best output the room produces.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import re
import string
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import httpx
import yaml
from rich.console import Console
from rich.table import Table

API = "https://openrouter.ai/api/v1"
HERE = Path(__file__).resolve().parent
console = Console(stderr=True)


class Transient(Exception):
    """Retryable upstream failure."""


# --------------------------------------------------------------------------
# config
# --------------------------------------------------------------------------

DEFAULT_CRITIC = """You are a working editor on a writers' room panel: brutal,
specific, and funny. You are not here to be encouraging. Mock the prose, not the
person. Quote the exact phrases that offend you. Name the stylistic tic each
writer cannot stop performing, and say what it reveals about how they were
trained to please. Zero throat-clearing, zero praise sandwiches, zero
"overall this is strong". If a draft is genuinely good, say so in one clause and
move on to what is still wrong with it."""


@dataclass
class Panelist:
    model: str
    alias: str = ""
    persona: str = ""          # extra flavour for this panelist's roasting voice
    temperature: float | None = None

    def __post_init__(self):
        if not self.alias:
            self.alias = self.model.split("/")[-1]


@dataclass
class Room:
    name: str
    brief: str
    panelists: list[Panelist]
    critic_prompt: str = DEFAULT_CRITIC
    draft_system: str = "Write the piece. Nothing else: no preamble, no sign-off, no meta-commentary."
    house_style: str = ""
    rounds: int = 1
    judge: str | None = None
    temperature: float = 0.9
    # Reasoning models spend this budget before emitting a visible token, so a
    # figure chosen for the prose alone truncates them. 1400 cost three runs:
    # drafts cut at 30 words, roasts cut mid-JSON, and a wrong winner.
    max_tokens: int = 3000
    # Optional OpenRouter reasoning control, e.g. {"effort": "low"} or
    # {"max_tokens": 500}. The alternative to raising max_tokens is capping the
    # thinking that consumes it.
    reasoning: dict | None = None
    default: bool = False        # the room the browser opens on
    blind: bool = True           # false names each draft's model, turning critique into score-settling
    exclude_self: bool = False   # true removes a panelist's own draft from its packet
    seed: int | None = None

    @classmethod
    def load(cls, path: Path) -> "Room":
        raw = yaml.safe_load(path.read_text())
        panelists = [Panelist(**p) for p in raw.pop("panelists")]
        raw.setdefault("name", path.stem)
        return cls(panelists=panelists, **raw)


# --------------------------------------------------------------------------
# transport
# --------------------------------------------------------------------------

ENV_FILE = HERE / ".env"
NO_KEY = (
    "No OpenRouter key found.\n"
    "  cp .env.example .env\n"
    "  # uncomment one key line in it and paste your key, then:\n"
    "  chmod 600 .env\n"
    "  uv run writers_room.py key      # checks it without printing it\n"
    "Or set OPENROUTER_API_KEY in the environment. See SECURITY.md."
)
_resolved: str | None = None


def env_file_value(name: str = "OPENROUTER_API_KEY") -> str | None:
    """Read one name out of the project .env, without a dotenv dependency.

    The same file serves both launch modes. Under `op run --env-file .env` the
    reference is resolved before this process starts and arrives as a literal
    in the environment; run directly, the reference lands here instead and is
    resolved by op read below. One file, two ways in, no second convention.
    """
    if not ENV_FILE.exists():
        return None
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == name:
            return v.strip().strip("'\"") or None
    return None


def check_permissions() -> str | None:
    """Return a warning if .env is readable beyond its owner.

    Not a hard failure: plenty of people run this on a single user laptop where
    it does not matter. It is worth one line of output so that the people for
    whom it does matter find out before their key does.
    """
    if not ENV_FILE.exists():
        return None
    mode = ENV_FILE.stat().st_mode & 0o777
    if mode & 0o077:
        return (f"{ENV_FILE.name} is mode {mode:03o}, readable by other accounts "
                f"on this machine. chmod 600 {ENV_FILE.name} to fix it.")
    return None


def key_source() -> str | None:
    """The configured credential, unresolved. Never triggers a 1Password prompt.

    Callers that only need to know whether a credential exists must use this.
    Resolving an op:// reference can block on Touch ID, which is not something
    to do while rendering a page.
    """
    env = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if env:
        return env
    return env_file_value()


def resolve_key(raw: str) -> str:
    """Turn a configured value into a usable key, shelling out to op if needed."""
    if not raw.startswith("op://"):
        return raw
    try:
        out = subprocess.run(
            ["op", "read", "--no-newline", raw],
            capture_output=True, text=True, timeout=120,
        )
    except FileNotFoundError:
        raise RuntimeError("1Password CLI not found. brew install 1password-cli") from None
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"timed out unlocking {raw}. Is the 1Password prompt waiting?") from None
    if out.returncode != 0:
        raise RuntimeError(f"op read {raw} failed: {out.stderr.strip()[:300]}")
    key = out.stdout.strip()
    if not key:
        raise RuntimeError(f"{raw} resolved to an empty value")
    return key


def api_key() -> str:
    """Resolve once per process. Repeated runs must not re-prompt for biometrics."""
    global _resolved
    if _resolved:
        return _resolved
    raw = key_source()
    if not raw:
        sys.exit(NO_KEY)
    _resolved = resolve_key(raw)
    return _resolved


def describe_key() -> str:
    """Where the credential comes from and whether it resolves. Prints no secret."""
    raw = key_source()
    if not raw:
        return "credential: none configured\n\n" + NO_KEY
    where = "OPENROUTER_API_KEY" if os.environ.get("OPENROUTER_API_KEY", "").strip() else str(ENV_FILE)
    kind = "1Password reference" if raw.startswith("op://") else "literal key"
    lines = [f"source:    {where}", f"kind:      {kind}"]
    warn = check_permissions()
    if warn:
        lines.append(f"warning:   {warn}")
    if raw.startswith("op://"):
        lines.append(f"reference: {raw}")
    try:
        key = resolve_key(raw)
    except RuntimeError as exc:
        return "\n".join(lines + [f"resolves:  NO. {exc}"])
    masked = key[:6] + "..." + key[-4:] if len(key) > 14 else "(short)"
    return "\n".join(lines + [f"resolves:  yes, {masked}, {len(key)} chars"])


@dataclass
class Usage:
    cost: float = 0.0
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0        # counted inside completion_tokens, and against max_tokens

    def add(self, other: "Usage") -> None:
        self.cost += other.cost
        self.calls += other.calls
        self.prompt_tokens += other.prompt_tokens
        self.completion_tokens += other.completion_tokens
        self.reasoning_tokens += other.reasoning_tokens


async def chat(
    client: httpx.AsyncClient,
    model: str,
    messages: list[dict],
    *,
    temperature: float,
    max_tokens: int,
    label: str,
    retries: int = 4,
    reasoning: dict | None = None,
) -> tuple[str, Usage]:
    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        # OpenRouter returns the normalised upstream cost only when asked.
        "usage": {"include": True},
    }
    if reasoning:
        body["reasoning"] = reasoning
    delay = 3.0
    for attempt in range(retries):
        try:
            r = await client.post("/chat/completions", json=body)
            if r.status_code in (408, 409, 429, 500, 502, 503, 520, 522, 524):
                raise Transient(f"HTTP {r.status_code}: {r.text[:200]}")
            r.raise_for_status()
            data = r.json()
            if not data.get("choices"):
                raise Transient(f"no choices: {json.dumps(data)[:300]}")
            choice = data["choices"][0]
            text = (choice["message"].get("content") or "").strip()
            if not text:
                raise Transient("empty completion")
            why = choice.get("finish_reason") or choice.get("native_finish_reason")
            if why and why not in ("stop", "end_turn", "eos"):
                det = (data.get("usage") or {}).get("completion_tokens_details") or {}
                think = int(det.get("reasoning_tokens") or 0)
                extra = f", {think} of them reasoning" if think else ""
                console.print(f"[yellow]{label} stopped early: finish_reason={why}, "
                              f"{len(text.split())} visible words{extra}. Raise max_tokens.")
            u = data.get("usage") or {}
            det = u.get("completion_tokens_details") or {}
            return text, Usage(
                cost=float(u.get("cost") or 0.0),
                calls=1,
                prompt_tokens=int(u.get("prompt_tokens") or 0),
                completion_tokens=int(u.get("completion_tokens") or 0),
                reasoning_tokens=int(det.get("reasoning_tokens") or 0),
            )
        except (Transient, httpx.HTTPError, json.JSONDecodeError) as exc:
            if attempt == retries - 1:
                console.print(f"[red]{label} failed after {retries} tries: {exc}")
                # No label in the text. This placeholder is handed to the other
                # panelists as if it were the draft, and the label is
                # "draft/<alias>", so including it de-anonymises that writer to
                # the whole room. Observed on 2026-09-04: glm-4.6 returned an
                # empty completion and another panelist quoted the placeholder
                # verbatim, naming it.
                return f"*[no output: {exc}]*", Usage(calls=1)
            console.print(f"[yellow]{label} retry {attempt + 1}: {exc}")
            await asyncio.sleep(delay)
            delay *= 2
    raise AssertionError("unreachable")


# --------------------------------------------------------------------------
# lenient JSON extraction
# --------------------------------------------------------------------------

def extract_json(text: str) -> dict | None:
    """Pull the first JSON object out of a model reply, fences or not."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    candidates = [fenced.group(1)] if fenced else []
    start = text.find("{")
    if start != -1:
        depth, in_str, esc = 0, False, False
        for i, ch in enumerate(text[start:], start):
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidates.append(text[start : i + 1])
                    break
    for c in candidates:
        try:
            parsed = json.loads(c)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue
    return None


# --------------------------------------------------------------------------
# prompts
# --------------------------------------------------------------------------

def draft_messages(room: Room) -> list[dict]:
    system = room.draft_system
    if room.house_style:
        system += "\n\n" + room.house_style.strip()
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": room.brief.strip()},
    ]


def roast_messages(
    room: Room,
    panelist: Panelist,
    packet: dict[str, str],
    names: dict[str, str],
    own: str | None,
) -> list[dict]:
    letters = sorted(packet)
    schema_letters = ", ".join(f'"{l}": "..."' for l in letters)
    ranking = json.dumps(letters)
    body = [
        "The brief every writer was given:",
        "---",
        room.brief.strip(),
        "---",
        "",
        (
            f"{len(letters)} anonymous drafts follow. One of them may be your own. "
            "You are not told which, and you should not try to be gentle in case it is."
            if room.blind
            else f"{len(letters)} drafts follow, each labelled with the model that wrote it"
            + (
                f". Draft {own} is your own: defend it if you think it deserves defending, "
                "but do not spare it."
                if own
                else "."
            )
            + " These are your rivals. Say what you actually think of how they write."
        ),
        "",
    ]
    for letter in letters:
        body += [f"### WRITER {letter}{names[letter]}", packet[letter].strip(), ""]
    body += [
        "Return a single fenced JSON object and nothing else:",
        "```json",
        "{",
        f'  "roasts": {{{schema_letters}}},',
        '  "tics": {' + ", ".join(f'"{l}": "the one habit this writer cannot stop"' for l in letters) + "},",
        f'  "ranking": {ranking},',
        '  "table_talk": "one line you would say out loud to the room"',
        "}",
        "```",
        "Each roast is 80 to 150 words, quotes at least one exact phrase from that "
        "draft, and is the funniest true thing you can say about it. `ranking` is "
        "best first. Do not soften anything.",
    ]
    system = room.critic_prompt.strip()
    if panelist.persona:
        system += "\n\n" + panelist.persona.strip()
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(body)},
    ]


def revise_messages(room: Room, own_draft: str, critiques: list[str]) -> list[dict]:
    joined = "\n\n".join(f"Critic {i + 1}:\n{c.strip()}" for i, c in enumerate(critiques))
    user = (
        "The brief:\n---\n"
        + room.brief.strip()
        + "\n---\n\nYour draft:\n---\n"
        + own_draft.strip()
        + "\n---\n\nWhat the room said about it:\n---\n"
        + joined
        + "\n---\n\nRewrite the piece. Concede what lands, ignore what is merely "
        "taste, and do not perform contrition. Output the revised piece only: no "
        "preamble, no change log, no defence."
    )
    system = room.draft_system
    if room.house_style:
        system += "\n\n" + room.house_style.strip()
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def verdict_messages(room: Room, packet: dict[str, str], names: dict[str, str]) -> list[dict]:
    letters = sorted(packet)
    body = [
        "You are judging a writers' room cage match. The brief:",
        "---",
        room.brief.strip(),
        "---",
        "",
        "The revised drafts:",
        "",
    ]
    for letter in letters:
        body += [f"### WRITER {letter}{names[letter]}", packet[letter].strip(), ""]
    body += [
        "Rank them best to worst. For each, give one sentence on what it does that "
        "the others do not, and one sentence on the tell that gives away it was "
        "machine-written. End with a line of exactly the form:",
        "RANKING: " + " > ".join(letters),
    ]
    return [
        {"role": "system", "content": "You are a merciless, specific literary judge. No hedging, no ties."},
        {"role": "user", "content": "\n".join(body)},
    ]


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------

DAMAGE_MAX = 18.0
HEAL = 6.0


def damage_from_ranking(ranking: list[str], letters: list[str], weight: float = 1.0) -> dict[str, float]:
    """Map one ranking onto HP damage for the arena.

    Damage is linear in rank index and Borda credit is linear and decreasing in
    the same index, so health stays a monotone transform of the scoreboard. That
    only holds if every source of damage carries the same constant, which is
    what `weight` is for: the judge counts as half the panel in the Borda total,
    so it must hit half the panel's worth harder here too. Getting this wrong
    inverts pairs on screen, observed live on 2026-09-04 before the weight
    existed.

    An empty ranking does nothing at all, matching the zero Borda an unparsed
    critic contributes. Damaging everyone equally instead is only order
    preserving while every letter is covered, which stops being true once a
    truncated reply is partly salvaged.
    """
    n = len(letters)
    if n < 2:
        return {l: 0.0 for l in letters}
    step = DAMAGE_MAX * weight / (n - 1)
    out = {l: 0.0 for l in letters}                  # no ballot, no Borda, no damage
    for i, l in enumerate(ranking):
        if l in out:
            out[l] = step * i
    return out


def complete_ranking(ranking: list[str], letters: list[str]) -> list[str]:
    """Append whatever a critic left out, so every ranking is a full order.

    Left partial, the omitted letters earn no Borda but still take damage, and
    the two measures drift apart. An empty ranking is left empty: a critic whose
    reply did not parse has expressed no opinion, and inventing an alphabetical
    one would be worse than scoring nothing.
    """
    if not ranking:
        return []
    return ranking + [l for l in letters if l not in ranking]


def salvage_pairs(text: str, letters: list[str], key: str = "roasts") -> dict:
    """Recover the complete "A": "..." entries from a JSON reply that was cut off.

    A roast truncated by max_tokens is invalid JSON, so the whole reply used to
    be discarded and handed to every author verbatim, fenced code and backslash
    escapes included. Observed on 2026-09-04: claude-opus-5 wrote four good
    roasts and was cut mid-way through the fifth, and all four were thrown away.
    Entries that did close are perfectly good, so keep them. The scan is scoped
    to one key, because `tics` shares the same letter keys and sits after
    `roasts` in the reply: an unscoped scan silently overwrote every roast with
    the one line tic for the same writer.
    """
    start = text.find(f'"{key}"')
    if start == -1:
        return {}
    seg = text[start:]
    for sibling in ('"roasts"', '"tics"', '"ranking"', '"table_talk"'):
        if sibling == f'"{key}"':
            continue                          # not a boundary for its own scan
        cut = seg.find(sibling, 1)            # from 1: the key itself opens seg
        if cut != -1:
            seg = seg[:cut]
    out = {}
    for m in re.finditer(r'"([A-Z])"\s*:\s*"((?:[^"\\]|\\.)*)"', seg):
        if m.group(1) in letters:
            try:
                out[m.group(1)] = json.loads(f'"{m.group(2)}"')
            except json.JSONDecodeError:
                continue
    return out


def judge_weight(rounds: list[dict]) -> float:
    """Half the ballots actually cast, not half the nominal panel.

    The judge used to be worth len(panelists)/2 regardless of how many critics
    returned a usable ranking. A critic whose reply was truncated contributes
    no ballot, so that fixed weight quietly grew as the panel failed. In the
    east-west run of 2026-09-04 two of six roasts were cut off, the judge's
    three votes then ran against four ballots rather than six, and it overturned
    a panelist that every surviving ballot had placed first.
    """
    cast = sum(1 for rnd in rounds for r in rnd["roasts"].values() if r.get("ranking"))
    return max(cast, 1) / 2.0


def only_letters(d: object, letters: list[str]) -> dict:
    """Keep the entries that name a writer who exists.

    Models invent panelists. A five-writer room has been observed coming back
    with a roast of Writer F, which then reaches anything that maps a letter to
    an author. Filtering here covers the transcript, the scoreboard and the
    event stream at once.
    """
    if not isinstance(d, dict):
        return {}
    return {k: v for k, v in d.items() if k in letters}


def parse_ranking(text: str, letters: list[str]) -> list[str]:
    m = re.search(r"RANKING:\s*([A-Z][A-Z\s>,]*)", text)
    seq = re.findall(r"[A-Z]", m.group(1)) if m else []
    out = [l for l in seq if l in letters]
    for l in letters:
        if l not in out:
            out.append(l)
    return out


async def run_room(room: Room, out_dir: Path, emit=None) -> dict:
    """Run the room. `emit(**event)` receives structured progress for a UI."""
    say = emit or (lambda **kw: None)
    rng = random.Random(room.seed)
    letters = list(string.ascii_uppercase[: len(room.panelists)])
    shuffled = room.panelists[:]
    rng.shuffle(shuffled)
    by_letter = dict(zip(letters, shuffled))              # letter -> panelist
    letter_of = {p.alias: l for l, p in by_letter.items()}
    # Letters stay the routing key in every mode. Only the visible label changes,
    # so an unblinded run still parses back to the right author.
    names = {
        l: "" if room.blind else f" = {p.alias} ({p.model})"
        for l, p in by_letter.items()
    }

    say(
        type="cast",
        room=room.name,
        brief=room.brief.strip(),
        blind=room.blind,
        rounds=room.rounds,
        judge=room.judge,
        cast=[
            {"letter": l, "alias": p.alias, "model": p.model}
            for l, p in sorted(by_letter.items())
        ],
    )

    total = Usage()
    gate = asyncio.Semaphore(6)
    headers = {
        "Authorization": f"Bearer {api_key()}",
        "HTTP-Referer": "https://github.com/local/writers-room",
        "X-Title": "writers-room",
    }

    async with httpx.AsyncClient(base_url=API, headers=headers, timeout=httpx.Timeout(300.0)) as client:

        async def call(panelist: Panelist, messages, label, max_tokens=None):
            say(type="call_start", label=label, alias=panelist.alias, model=panelist.model)
            async with gate:
                text, usage = await chat(
                    client,
                    panelist.model,
                    messages,
                    temperature=panelist.temperature if panelist.temperature is not None else room.temperature,
                    max_tokens=max_tokens or room.max_tokens,
                    label=label,
                    reasoning=room.reasoning,
                )
            total.add(usage)
            say(type="call_end", label=label, alias=panelist.alias)
            say(type="cost", calls=total.calls, cost=round(total.cost, 6),
                prompt_tokens=total.prompt_tokens, completion_tokens=total.completion_tokens)
            return text

        # --- phase 1: drafts
        console.rule("[bold]draft")
        say(type="phase", phase="draft", round=0)
        drafts_list = await asyncio.gather(
            *(call(p, draft_messages(room), f"draft/{p.alias}") for p in room.panelists)
        )
        drafts = {letter_of[p.alias]: d for p, d in zip(room.panelists, drafts_list)}
        for p in room.panelists:
            letter = letter_of[p.alias]
            console.print(f"  {letter}  {p.alias}  ({len(drafts[letter].split())} words)")
            say(type="draft", letter=letter, alias=p.alias, text=drafts[letter],
                words=len(drafts[letter].split()))

        rounds: list[dict] = []
        current = dict(drafts)

        for rnd in range(room.rounds):
            # --- phase 2: roasts
            console.rule(f"[bold]roast {rnd + 1}")
            say(type="phase", phase="roast", round=rnd + 1)
            packets = {}
            for p in room.panelists:
                packet = dict(current)
                if room.exclude_self:
                    packet.pop(letter_of[p.alias], None)
                packets[p.alias] = packet
            raw_roasts = await asyncio.gather(
                *(call(p,
                       roast_messages(room, p, packets[p.alias], names,
                                      None if (room.blind or room.exclude_self) else letter_of[p.alias]),
                       f"roast/{p.alias}", room.max_tokens * 2)
                  for p in room.panelists)
            )

            roasts = {}
            for p, raw in zip(room.panelists, raw_roasts):
                parsed = extract_json(raw) or {}
                kept = only_letters(parsed.get("roasts"), letters)
                if not kept:                      # truncated reply: take what closed
                    kept = only_letters(salvage_pairs(raw, letters), letters)
                roasts[p.alias] = {
                    "raw": raw,
                    # empty means unusable, and the raw reply goes to everyone instead
                    "roasts": kept or None,
                    "tics": only_letters(parsed.get("tics"), letters),
                    "ranking": complete_ranking(
                        [l for l in (parsed.get("ranking") or []) if l in letters], letters),
                    "table_talk": parsed.get("table_talk", ""),
                }
                mark = "ok" if roasts[p.alias]["roasts"] else "unparsed"
                console.print(f"  {p.alias}: {mark}")

                r = roasts[p.alias]
                dmg = damage_from_ranking(r["ranking"], letters)
                if r["table_talk"]:
                    say(type="table_talk", **{"from": p.alias}, text=str(r["table_talk"]))
                targets = r["roasts"] or {l: r["raw"] for l in packets[p.alias]}
                for l in sorted(targets):
                    if l not in by_letter:
                        continue
                    say(type="roast", round=rnd + 1, **{"from": p.alias},
                        target=l, target_alias=by_letter[l].alias,
                        text=str(targets[l]).strip(), tic=str(r["tics"].get(l, "")),
                        self_roast=(by_letter[l].alias == p.alias),
                        parsed=bool(r["roasts"]), damage=round(dmg.get(l, 0.0), 2))
                if r["ranking"]:
                    say(type="ranking", **{"from": p.alias}, order=r["ranking"])

            # --- phase 3: revisions
            console.rule(f"[bold]revise {rnd + 1}")
            say(type="phase", phase="revise", round=rnd + 1)
            crit_for = {l: [] for l in letters}
            for alias, r in roasts.items():
                if r["roasts"]:
                    for l, txt in r["roasts"].items():
                        if l in crit_for and isinstance(txt, str):
                            crit_for[l].append(txt)
                else:
                    # unparsed reply: hand the whole thing to everyone rather than lose it
                    for l in letters:
                        crit_for[l].append(r["raw"])
            revised_list = await asyncio.gather(
                *(call(p, revise_messages(room, current[letter_of[p.alias]], crit_for[letter_of[p.alias]]),
                       f"revise/{p.alias}")
                  for p in room.panelists)
            )
            revisions = {letter_of[p.alias]: t for p, t in zip(room.panelists, revised_list)}
            for p in room.panelists:
                letter = letter_of[p.alias]
                say(type="revision", round=rnd + 1, letter=letter, alias=p.alias,
                    text=revisions[letter], words=len(revisions[letter].split()), heal=HEAL)
            rounds.append({"roasts": roasts, "revisions": revisions, "before": dict(current)})
            current = revisions

        # --- phase 4: verdict
        verdict = None
        if room.judge:
            console.rule("[bold]verdict")
            say(type="phase", phase="verdict", round=room.rounds)
            judge = Panelist(model=room.judge, alias="judge")
            verdict = await call(judge, verdict_messages(room, current, names), "verdict", room.max_tokens * 2)
            judge_order = parse_ranking(verdict, letters)
            say(type="verdict", text=verdict, order=judge_order, judge=room.judge,
                damage={l: round(v, 2) for l, v in damage_from_ranking(
                    judge_order, letters, weight=judge_weight(rounds)).items()})

    # --- scoreboard: Borda over every roaster ranking, plus the judge
    scores = {l: 0.0 for l in letters}
    n = len(letters)
    for rnd in rounds:
        for r in rnd["roasts"].values():
            for i, l in enumerate(r["ranking"]):
                if l in scores:
                    scores[l] += n - i
    weight = judge_weight(rounds)
    if verdict:
        for i, l in enumerate(parse_ranking(verdict, letters)):
            scores[l] += (n - i) * weight

    result = {
        "room": room.name,
        "when": datetime.now().isoformat(timespec="seconds"),
        "brief": room.brief,
        "blind": room.blind,
        "identities": {l: {"alias": p.alias, "model": p.model} for l, p in by_letter.items()},
        "drafts": drafts,
        "rounds": rounds,
        "final": current,
        "verdict": verdict,
        "scores": scores,
        "judge_weight": weight,
        "usage": vars(total),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "raw.json").write_text(json.dumps(result, indent=2))
    (out_dir / "transcript.md").write_text(render(room, result))

    table = Table(title="scoreboard (Borda)")
    table.add_column("model")
    table.add_column("letter")
    table.add_column("score", justify="right")
    for l, s in sorted(scores.items(), key=lambda kv: -kv[1]):
        table.add_row(by_letter[l].alias, l, f"{s:.1f}")
    console.print(table)
    console.print(f"[green]{total.calls} calls, ${total.cost:.4f}[/green]  ->  {out_dir}/transcript.md")
    say(type="scores", scores={l: round(v, 2) for l, v in scores.items()},
        winner=max(scores, key=lambda l: scores[l]) if scores else None)
    say(type="done", out_dir=str(out_dir), calls=total.calls, cost=round(total.cost, 6))
    return result


# --------------------------------------------------------------------------
# transcript
# --------------------------------------------------------------------------

def render(room: Room, r: dict) -> str:
    ident = r["identities"]
    who = lambda l: f"{ident[l]['alias']} (`{ident[l]['model']}`)"
    mode = "blind" if r.get("blind", True) else "named: every panelist knew who wrote what"
    out = [f"# {r['room']}", "", f"*{r['when']}, {mode}*", "", "## Brief", "", r["brief"].strip(), "",
           "## Cast", ""]
    for l in sorted(ident):
        out.append(f"- **Writer {l}** = {who(l)}")
    out += ["", "## Round 0: drafts", ""]
    for l in sorted(r["drafts"]):
        out += [f"### Writer {l} = {who(l)}", "", r["drafts"][l].strip(), ""]

    for i, rnd in enumerate(r["rounds"], 1):
        out += [f"## Round {i}: the roast", ""]
        for alias, roast in rnd["roasts"].items():
            out += [f"### {alias} holds forth", ""]
            if roast["table_talk"]:
                out += [f"> {roast['table_talk']}", ""]
            if roast["roasts"]:
                for l in sorted(k for k in roast["roasts"] if k in ident):
                    tag = " *(this is their own draft)*" if ident[l]["alias"] == alias else ""
                    out += [f"**On Writer {l} = {who(l)}**{tag}", "", str(roast["roasts"][l]).strip(), ""]
                if roast["tics"]:
                    out += ["Tics called out:", ""]
                    out += [f"- Writer {l}: {t}" for l, t in sorted(roast["tics"].items())
                            if l in ident] + [""]
                if roast["ranking"]:
                    out += ["Ranking: " + " > ".join(roast["ranking"]), ""]
            else:
                out += ["*(unstructured reply, verbatim)*", "", roast["raw"].strip(), ""]
        out += [f"## Round {i}: revisions", ""]
        for l in sorted(rnd["revisions"]):
            out += [f"### Writer {l} = {who(l)}", "", rnd["revisions"][l].strip(), ""]

    if r.get("verdict"):
        out += ["## Verdict", "", r["verdict"].strip(), ""]
    out += ["## Scoreboard", "", "| model | letter | Borda |", "|---|---|---|"]
    for l, s in sorted(r["scores"].items(), key=lambda kv: -kv[1]):
        out.append(f"| {who(l)} | {l} | {s:.1f} |")
    u = r["usage"]
    think = f", {u['reasoning_tokens']} of the output spent on reasoning" if u.get("reasoning_tokens") else ""
    out += ["", f"*{u['calls']} calls, {u['prompt_tokens']}+{u['completion_tokens']} tokens{think}, ${u['cost']:.4f}*", ""]
    return "\n".join(out)


def reparse(run_dir: Path) -> dict:
    """Re-read a finished run's stored replies and rewrite its record.

    Parsing improves after the money is spent. This re-runs the current parser
    over the verbatim replies already on disk, so critique that was discarded
    can be recovered without paying again. It cannot change what the panelists
    were shown at the time: the revisions in the run were written against
    whatever the parser produced on the day, and they stay as they are. Only
    the record changes, and the original is kept alongside it.
    """
    raw_path = run_dir / "raw.json"
    r = json.loads(raw_path.read_text())
    letters = sorted(r["identities"])
    changed = []

    for rnd in r["rounds"]:
        for alias, entry in rnd["roasts"].items():
            text = entry.get("raw") or ""
            parsed = extract_json(text) or {}
            kept = only_letters(parsed.get("roasts"), letters)
            if not kept:
                kept = only_letters(salvage_pairs(text, letters), letters)
            tics = only_letters(parsed.get("tics"), letters) or \
                only_letters(salvage_pairs(text, letters, key="tics"), letters)
            ranking = complete_ranking(
                [l for l in (parsed.get("ranking") or []) if l in letters], letters)
            had = len(entry.get("roasts") or {})
            if len(kept) > had:
                changed.append(f"recovered {alias}: {had} -> {len(kept)} roasts")
            elif len(kept) < had:
                changed.append(f"dropped invented writers from {alias}: {had} -> {len(kept)}")
            entry["roasts"] = kept or None
            entry["tics"] = tics
            entry["ranking"] = ranking or entry.get("ranking") or []

    n = len(letters)
    scores = {l: 0.0 for l in letters}
    for rnd in r["rounds"]:
        for entry in rnd["roasts"].values():
            for i, l in enumerate(entry["ranking"]):
                if l in scores:
                    scores[l] += n - i
    weight = judge_weight(r["rounds"])
    if r.get("verdict"):
        for i, l in enumerate(parse_ranking(r["verdict"], letters)):
            scores[l] += (n - i) * weight
    before = r.get("scores") or {}
    r["scores"], r["judge_weight"] = scores, weight

    backup = run_dir / "raw.pre-reparse.json"
    if not backup.exists():
        backup.write_text(raw_path.read_text())
    raw_path.write_text(json.dumps(r, indent=2))
    room = Room(name=r["room"], brief=r["brief"], panelists=[])
    (run_dir / "transcript.md").write_text(render(room, r))

    for line in changed:
        console.print(f"  [green]{line}[/green]")
    if not changed:
        console.print("  [dim]nothing new to recover[/dim]")
    t = Table(title="scores")
    t.add_column("writer"); t.add_column("before", justify="right"); t.add_column("after", justify="right")
    for l in sorted(scores, key=lambda x: -scores[x]):
        t.add_row(f"{l} = {r['identities'][l]['alias']}", f"{before.get(l, 0):.1f}", f"{scores[l]:.1f}")
    console.print(t)
    console.print(f"[green]judge weight {weight:.1f}[/green], original kept at {backup}")
    return r


# --------------------------------------------------------------------------
# cli
# --------------------------------------------------------------------------

async def list_models(pattern: str | None) -> None:
    async with httpx.AsyncClient(base_url=API, timeout=60) as client:
        data = (await client.get("/models")).json()["data"]
    rows = [m for m in data if not pattern or pattern.lower() in m["id"].lower()]
    rows.sort(key=lambda m: m["id"])
    t = Table(title=f"OpenRouter models ({len(rows)})")
    t.add_column("id"); t.add_column("ctx", justify="right"); t.add_column("$/Mtok in", justify="right")
    for m in rows[:200]:
        price = float(m.get("pricing", {}).get("prompt") or 0) * 1e6
        t.add_row(m["id"], str(m.get("context_length", "")), f"{price:.2f}")
    Console().print(t)


def main() -> None:
    ap = argparse.ArgumentParser(description="Run a multi-model writers' room.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="run a room from a YAML config")
    run.add_argument("config", type=Path)
    run.add_argument("--brief", help="override the brief with this text, or @path to read a file")
    run.add_argument("--rounds", type=int)
    run.add_argument("--models", help="comma-separated OpenRouter ids, replacing the roster")
    run.add_argument("--judge")
    run.add_argument("--no-judge", action="store_true")
    run.add_argument("--no-blind", action="store_true",
                     help="name each draft's model in the packet: score-settling rather than style criticism")
    run.add_argument("--blind", action="store_true", help="force anonymous drafts (the default)")
    run.add_argument("--exclude-self", action="store_true")
    run.add_argument("--seed", type=int)
    run.add_argument("--out", type=Path, default=HERE / "runs")

    ls = sub.add_parser("models", help="list models available on OpenRouter")
    ls.add_argument("pattern", nargs="?")

    sub.add_parser("key", help="show where the credential comes from and whether it resolves")

    rr = sub.add_parser("render", help="rebuild transcript.md from a run's raw.json, no API calls")
    rr.add_argument("run_dir", type=Path)

    rp = sub.add_parser("reparse", help="re-read a finished run's stored replies with the current parser")
    rp.add_argument("run_dir", type=Path)

    args = ap.parse_args()
    if args.cmd == "models":
        asyncio.run(list_models(args.pattern))
        return
    if args.cmd == "key":
        print(describe_key())
        return
    if args.cmd == "reparse":
        reparse(args.run_dir)
        return
    if args.cmd == "render":
        raw = json.loads((args.run_dir / "raw.json").read_text())
        room = Room(name=raw["room"], brief=raw["brief"], panelists=[])
        out = args.run_dir / "transcript.md"
        out.write_text(render(room, raw))
        console.print(f"[green]rewrote {out}")
        return

    room = Room.load(args.config)
    if args.brief:
        room.brief = Path(args.brief[1:]).read_text() if args.brief.startswith("@") else args.brief
    if args.rounds is not None:
        room.rounds = args.rounds
    if args.models:
        room.panelists = [Panelist(model=m.strip()) for m in args.models.split(",") if m.strip()]
    if args.judge:
        room.judge = args.judge
    if args.no_judge:
        room.judge = None
    if args.no_blind:
        room.blind = False
    if args.blind:
        room.blind = True
    if args.exclude_self:
        room.exclude_self = True
    if args.seed is not None:
        room.seed = args.seed

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = args.out / f"{stamp}-{room.name}"
    t0 = time.time()
    asyncio.run(run_room(room, out_dir))
    console.print(f"[dim]{time.time() - t0:.0f}s[/dim]")


if __name__ == "__main__":
    main()
