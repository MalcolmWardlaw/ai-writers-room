# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27", "pyyaml>=6", "rich>=13"]
# ///
import asyncio, importlib.util, json, os, sys, tempfile
from pathlib import Path

os.environ["OPENROUTER_API_KEY"] = "test"
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("wr", ROOT / "writers_room.py")
wr = importlib.util.module_from_spec(spec); sys.modules["wr"] = wr; spec.loader.exec_module(wr)

CALLS = []
async def fake_chat(client, model, messages, *, temperature, max_tokens, label, retries=4, **kw):
    CALLS.append(label)
    if label.startswith("roast"):
        payload = {"roasts": {l: f"{model} eviscerates {l}." for l in "ABC"},
                   "tics": {l: f"tic {l}" for l in "ABC"},
                   "ranking": ["B", "A", "C"], "table_talk": "Someone bring me a red pen."}
        return "sure thing:\n```json\n" + json.dumps(payload) + "\n```", wr.Usage(cost=0.01, calls=1, prompt_tokens=10, completion_tokens=20)
    if label == "verdict":
        return "Reasons.\nRANKING: C > A > B", wr.Usage(cost=0.02, calls=1)
    return f"[{label}] body text here", wr.Usage(cost=0.005, calls=1, prompt_tokens=5, completion_tokens=7)

wr.chat = fake_chat
room = wr.Room(name="t", brief="Write a thing.", rounds=2, judge="j/j",
               panelists=[wr.Panelist("a/one"), wr.Panelist("b/two"), wr.Panelist("c/three")], seed=3)
out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp())
res = asyncio.run(wr.run_room(room, out))

assert sorted(CALLS).count("draft/one") == 1
assert len([c for c in CALLS if c.startswith("roast")]) == 6, CALLS
assert len([c for c in CALLS if c.startswith("revise")]) == 6
assert "verdict" in CALLS
assert len(res["rounds"]) == 2
md = (out / "transcript.md").read_text()
for probe in ["## Round 0: drafts", "## Round 2: revisions", "## Verdict", "this is their own draft", "Scoreboard"]:
    assert probe in md, probe
assert "—" not in md, "em-dash leaked into transcript"
json.loads((out / "raw.json").read_text())
# unparsed-roast fallback path
assert wr.extract_json("garbage") is None
assert wr.extract_json('noise {"a": {"b": 1}} tail')["a"]["b"] == 1
assert wr.parse_ranking("RANKING: C > A", ["A","B","C"]) == ["C","A","B"]
# named (non-blind) mode: labels reveal the model, JSON keys stay letters
SEEN = []
async def spy_chat(client, model, messages, *, temperature, max_tokens, label, retries=4, **kw):
    SEEN.append((label, messages[-1]["content"]))
    return await fake_chat(client, model, messages, temperature=temperature,
                           max_tokens=max_tokens, label=label, retries=retries, **kw)
wr.chat = spy_chat
named = wr.Room(name="t2", brief="Write a thing.", rounds=1, judge="j/j", blind=False,
                panelists=[wr.Panelist("a/one"), wr.Panelist("b/two"), wr.Panelist("c/three")], seed=3)
out2 = out.parent / "out-named"
res2 = asyncio.run(wr.run_room(named, out2))
roast_prompts = [c for l, c in SEEN if l.startswith("roast")]
assert all("### WRITER A = two (b/two)" in c for c in roast_prompts), roast_prompts[0][:500]
assert all("is your own" in c for c in roast_prompts)
assert not any("anonymous drafts follow" in c for c in roast_prompts)
verdict_prompt = [c for l, c in SEEN if l == "verdict"][0]
assert "= three (c/three)" in verdict_prompt
assert '"ranking": ["A", "B", "C"]' in roast_prompts[0]      # letters still the routing key
assert res2["rounds"][0]["revisions"].keys() == set("ABC")   # critique still routed home
assert "named: every panelist knew who wrote what" in (out2 / "transcript.md").read_text()
blind_prompt = [c for l, c in SEEN if l.startswith("roast")][0]
assert wr.Room(name="x", brief="b", panelists=[wr.Panelist("a/b")]).blind is True

# a critic that invents a writer who does not exist. Observed live on
# 2026-09-04: a five-panelist room came back with a roast of Writer F, which
# crashed the transcript renderer on a letter with no author behind it.
async def hallucinating_chat(client, model, messages, *, temperature, max_tokens, label, retries=4, **kw):
    if label.startswith("roast"):
        payload = {"roasts": {l: f"on {l}" for l in "ABCF"},
                   "tics": {l: f"tic {l}" for l in "ABCF"},
                   "ranking": ["F", "B", "A", "C"], "table_talk": "I counted an extra chair."}
        return "```json\n" + json.dumps(payload) + "\n```", wr.Usage(calls=1)
    return f"[{label}] body", wr.Usage(calls=1)

wr.chat = hallucinating_chat
ghost = wr.Room(name="ghost", brief="Write a thing.", rounds=1,
                panelists=[wr.Panelist("a/one"), wr.Panelist("b/two"), wr.Panelist("c/three")], seed=1)
out3 = out.parent / "out-ghost"
res3 = asyncio.run(wr.run_room(ghost, out3))          # must not raise
for r in res3["rounds"][0]["roasts"].values():
    assert set(r["roasts"]) == set("ABC"), r["roasts"]
    assert set(r["tics"]) == set("ABC"), r["tics"]
    assert "F" not in r["ranking"]
assert "F" not in res3["scores"]
md3 = (out3 / "transcript.md").read_text()
assert "Writer F" not in md3
assert wr.only_letters({"A": 1, "Z": 2}, ["A", "B"]) == {"A": 1}
assert wr.only_letters("not a dict", ["A"]) == {}

# A failed call must not name the model in the text handed to the other
# panelists. Observed live 2026-09-04: the placeholder carried "draft/glm-4.6",
# another panelist quoted it, and the blind run stopped being blind.
async def failing_chat(client, model, messages, *, temperature, max_tokens, label, retries=4, **kw):
    if label.startswith("draft") and "one" in label:
        return await wr.chat.__wrapped__(client, model, messages, temperature=temperature,
                                         max_tokens=max_tokens, label=label, retries=retries, **kw) \
            if hasattr(wr.chat, "__wrapped__") else ("*[no output: boom]*", wr.Usage(calls=1))
    return f"[{label}] body", wr.Usage(calls=1)

wr.chat = failing_chat
leak = wr.Room(name="leak", brief="Write a thing.", rounds=1,
               panelists=[wr.Panelist("a/one"), wr.Panelist("b/two")], seed=5)
out4 = out.parent / "out-leak"
res4 = asyncio.run(wr.run_room(leak, out4))
placeholder = [t for t in res4["drafts"].values() if "no output" in t]
assert placeholder, res4["drafts"]
for t in placeholder:
    assert "one" not in t and "draft/" not in t, f"placeholder names the model: {t}"

# A roast cut off by max_tokens is invalid JSON, but the entries that closed
# are good. Observed 2026-09-04: opus wrote four usable roasts and was cut in
# the fifth, and all four were discarded.
truncated = ('```json\n{\n  "roasts": {\n    "A": "Quotes \\"like this\\" survive.",\n'
             '    "B": "Second one closed too.",\n    "C": "cut off here mid-str')
sal = wr.salvage_pairs(truncated, ["A", "B", "C"])
assert set(sal) == {"A", "B"}, sal
assert sal["A"] == 'Quotes "like this" survive.'
assert wr.extract_json(truncated) is None            # strict parse still fails
assert wr.salvage_pairs("no pairs here", ["A"]) == {}
assert wr.salvage_pairs(truncated, ["A"], key="nosuch") == {}

# tics share the letter keys and sit after roasts, so an unscoped scan
# overwrote every roast with that writer's one line tic
both = ('{"roasts": {"A": "the long roast", "B": "another roast"}, '
        '"tics": {"A": "the short tic", "B": "another tic"}, "ranking": ["A","B"]}')
assert wr.salvage_pairs(both, ["A", "B"]) == {"A": "the long roast", "B": "another roast"}
assert wr.salvage_pairs(both, ["A", "B"], key="tics") == {"A": "the short tic", "B": "another tic"}

print("\nALL OFFLINE TESTS PASSED")
print(md[:400])
