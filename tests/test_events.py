# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27", "pyyaml>=6", "rich>=13", "starlette>=0.37", "uvicorn>=0.30"]
# ///
"""The event contract: engine, replay and browser must agree on the vocabulary.

No API calls. The live path is exercised through run_room with a stubbed
transport, which is the same code a paid run takes.
"""
import asyncio, importlib.util, json, os, re, sys, tempfile
from pathlib import Path

os.environ["OPENROUTER_API_KEY"] = "test"
ROOT = Path(__file__).resolve().parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


wr = load("writers_room", ROOT / "writers_room.py")
arena = load("arena", ROOT / "arena.py")

N = 3
LETTERS = list("ABC")


async def fake_chat(client, model, messages, *, temperature, max_tokens, label, retries=4, **kw):
    if label.startswith("roast"):
        payload = {"roasts": {l: f"{model} on {l}: \"a quoted phrase\" is a crime." for l in LETTERS},
                   "tics": {l: f"tic {l}" for l in LETTERS},
                   "ranking": ["B", "A", "C"], "table_talk": "Bring me a red pen."}
        return "```json\n" + json.dumps(payload) + "\n```", wr.Usage(cost=0.01, calls=1)
    if label == "verdict":
        return "Reasons.\nRANKING: C > A > B", wr.Usage(cost=0.02, calls=1)
    return f"[{label}] body text", wr.Usage(cost=0.005, calls=1)


# ---------------------------------------------------------------- live path
wr.chat = fake_chat
events = []
room = wr.Room(name="t", brief="Write a thing.", rounds=2, judge="j/j", seed=3,
               panelists=[wr.Panelist("a/one"), wr.Panelist("b/two"), wr.Panelist("c/three")])
tmp = Path(tempfile.mkdtemp())
asyncio.run(wr.run_room(room, tmp / "live", emit=lambda **e: events.append(e)))

kinds = [e["type"] for e in events]
assert kinds[0] == "cast" and kinds[-1] == "done", kinds[:3]
assert len(events[0]["cast"]) == N
assert {c["letter"] for c in events[0]["cast"]} == set(LETTERS)

phases = [(e["phase"], e["round"]) for e in events if e["type"] == "phase"]
assert phases == [("draft", 0), ("roast", 1), ("revise", 1), ("roast", 2), ("revise", 2), ("verdict", 2)], phases

assert kinds.count("draft") == N
roasts = [e for e in events if e["type"] == "roast"]
assert len(roasts) == N * N * 2, len(roasts)            # everyone roasts everyone, both rounds
assert sum(r["self_roast"] for r in roasts) == N * 2    # exactly one self-roast each per round
assert all(r["parsed"] for r in roasts)
assert kinds.count("revision") == N * 2
assert kinds.count("verdict") == 1
assert kinds.count("scores") == 1

# every call is opened and closed, so no avatar is left thinking forever
opened = [e["label"] for e in events if e["type"] == "call_start"]
assert sorted(opened) == sorted(e["label"] for e in events if e["type"] == "call_end")
assert len(opened) == N + (N + N) * 2 + 1              # drafts, roast+revise per round, judge

# --------------------------------------------------- damage tracks the Borda
dmg = wr.damage_from_ranking(["B", "A", "C"], LETTERS)
assert dmg["B"] == 0 and dmg["C"] == wr.DAMAGE_MAX and dmg["A"] == wr.DAMAGE_MAX / 2
borda = {l: len(LETTERS) - i for i, l in enumerate(["B", "A", "C"])}
by_dmg = sorted(LETTERS, key=lambda l: dmg[l])
by_borda = sorted(LETTERS, key=lambda l: -borda[l])
assert by_dmg == by_borda, "health bars would contradict the scoreboard"
# A critic with no ballot gives no Borda, so it must deal no damage. Equal
# damage to everyone was order preserving only while every letter was covered,
# which fails once a truncated reply is partly salvaged and covers some.
assert wr.damage_from_ranking([], LETTERS) == {l: 0.0 for l in LETTERS}
# the judge's weight multiplies the same scale, so the two stay comparable
assert wr.damage_from_ranking(["B", "A", "C"], LETTERS, weight=2.0)["C"] == wr.DAMAGE_MAX * 2.0

# ---------------------------------------------------------- replay path
shipped = json.loads((ROOT / "demo" / "sample.json").read_text())
rep = []
asyncio.run(arena.replay(shipped, lambda **e: rep.append(e), pace=0))
rk = [e["type"] for e in rep]
assert rk[0] == "cast" and rk[-1] == "done"
assert rk.count("roast") == 16 and rk.count("draft") == 4 and rk.count("revision") == 4
assert rk.count("verdict") == 1
assert sum(e.get("self_roast", False) for e in rep if e["type"] == "roast") == 4
assert set(rk) <= set(kinds), set(rk) - set(kinds)   # replay invents no new events

# the shipped demo has to agree with itself: HP order must match the Borda order
hp = {l: 100.0 for l in "ABCD"}
for e in rep:
    if e["type"] == "roast":
        hp[e["target"]] -= e["damage"]
    if e["type"] == "revision":
        hp[e["letter"]] += e["heal"]
scores = shipped["scores"]
assert sorted(hp, key=lambda l: -hp[l]) == sorted(scores, key=lambda l: -scores[l]), (hp, scores)

# ------------------------- the health bars must not contradict the scoreboard
# Regression: before the judge's damage carried its Borda weight, a real run
# (20260904-094346-claudese) put DeepSeek below GPT on health while ranking it
# above on Borda. Replay every stored run and re-check the invariant.
def hp_order(evts, letters):
    hp = {l: 100.0 for l in letters}
    for e in evts:
        if e["type"] == "roast":
            hp[e["target"]] -= e["damage"]
        elif e["type"] == "revision":
            hp[e["letter"]] += e["heal"]
        elif e["type"] == "verdict":
            for l, d in (e.get("damage") or {}).items():
                hp[l] -= d
    return sorted(hp, key=lambda l: -hp[l]), hp


for name, evts, scores, letters in [
    ("live stub", events, [e for e in events if e["type"] == "scores"][-1]["scores"], LETTERS),
    ("shipped demo", rep, shipped["scores"], sorted(shipped["identities"])),
]:
    order, hp = hp_order(evts, letters)
    assert order == sorted(scores, key=lambda l: -scores[l]), (name, hp, scores)

for run in sorted((ROOT / "runs").glob("*/raw.json")):
    stored = json.loads(run.read_text())
    evts = []
    asyncio.run(arena.replay(stored, lambda **e: evts.append(e), pace=0))
    letters = sorted(stored["identities"])
    _, hp = hp_order(evts, letters)
    sc = stored["scores"]
    # Pairwise rather than list equality: Borda ties are common and a tie has no
    # defined order, so comparing sorted lists tests the sort, not the invariant.
    for a in letters:
        for b in letters:
            if round(hp[a], 6) > round(hp[b], 6):
                assert sc[a] >= sc[b], f"{run.parent.name}: {a} outranks {b} on hp but not borda"
    print(f"  invariant holds on {run.parent.name}")

# ------------------------------------------------------------- failure path
# A broken run has to reach the page as an event, not a stack trace in the log.
arena.BUS.reset()
asyncio.run(arena.drive({"room": "no-such-room.yaml"}))
bad = [e for e in arena.BUS.history if e["type"] == "error"]
assert bad and "FileNotFoundError" in bad[0]["message"], arena.BUS.history
assert not arena.BUS.running

# the bus replays its backlog to a browser that connects late
assert [e["type"] for e in arena.BUS.history][:1] == ["reset"]
assert all("seq" in e for e in arena.BUS.history)

# ------------------------------------------------- the browser handles them all
js = (ROOT / "static" / "arena.js").read_text()
handled = set(re.findall(r"case '(\w+)':", js))
emitted = set(kinds) | set(rk) | {e['type'] for e in arena.BUS.history}
assert emitted <= handled, f"unhandled in the UI: {emitted - handled}"
assert handled <= emitted, f"UI handles events nothing emits: {handled - emitted}"

for path in (ROOT / "demo" / "sample.json", ROOT / "static" / "arena.js", ROOT / "arena.py"):
    assert "—" not in path.read_text(), f"em-dash in {path.name}"

print(f"ALL EVENT TESTS PASSED  ({len(events)} live events, {len(rep)} replay events)")
