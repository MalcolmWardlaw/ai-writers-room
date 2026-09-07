#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27", "pyyaml>=6", "rich>=13", "starlette>=0.37", "uvicorn>=0.30"]
# ///
"""The arena: a browser front end for writers_room.py.

Serves a single page that draws the panel as fighters, then streams the room's
progress into it over SSE. Every roast is a hit, every revision is a heal, and
the health bars are a monotone transform of the Borda scoreboard, so the cartoon
cannot disagree with the arithmetic.

  uv run arena.py                      # opens http://127.0.0.1:8770
  uv run arena.py --port 9000 --no-open

A run is started from the page. `demo` mode replays a canned transcript with no
key and no spend; `replay` mode does the same for anything under runs/.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import os
import sys
import time
import webbrowser
from datetime import datetime
from pathlib import Path

import yaml
from starlette.applications import Starlette
from starlette.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("writers_room", HERE / "writers_room.py")
wr = importlib.util.module_from_spec(spec)
sys.modules["writers_room"] = wr
spec.loader.exec_module(wr)


# --------------------------------------------------------------------------
# event bus
# --------------------------------------------------------------------------

class Bus:
    """Fan-out with replay. A browser that connects late still sees the whole fight."""

    def __init__(self) -> None:
        self.history: list[dict] = []
        self.subscribers: set[asyncio.Queue] = set()
        self.task: asyncio.Task | None = None
        self.seq = 0

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def reset(self) -> None:
        self.history.clear()
        self.seq = 0
        self.publish(type="reset")

    def publish(self, **event) -> None:
        self.seq += 1
        event["seq"] = self.seq
        event.setdefault("t", round(time.time(), 3))
        self.history.append(event)
        for q in list(self.subscribers):
            q.put_nowait(event)

    async def stream(self):
        q: asyncio.Queue = asyncio.Queue()
        for event in list(self.history):          # catch the newcomer up first
            q.put_nowait(event)
        self.subscribers.add(q)
        try:
            yield b": connected\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield b": keepalive\n\n"      # keep proxies and Safari honest
                    continue
                yield f"data: {json.dumps(event)}\n\n".encode()
        finally:
            self.subscribers.discard(q)


BUS = Bus()


# --------------------------------------------------------------------------
# replay: turn a finished raw.json back into the live event stream
# --------------------------------------------------------------------------

async def replay(result: dict, publish, pace: float = 0.25) -> None:
    """Re-emit a stored run so the arena can be driven with no key and no spend."""
    ident = result["identities"]
    alias_of = {l: v["alias"] for l, v in ident.items()}
    letters = sorted(ident)

    publish(type="cast", room=result.get("room", "replay"), brief=result.get("brief", "").strip(),
            blind=result.get("blind", True), rounds=len(result.get("rounds", [])),
            judge=None, replay=True, fabricated=result.get("fabricated"),
            cast=[{"letter": l, "alias": ident[l]["alias"], "model": ident[l]["model"]} for l in letters])

    publish(type="phase", phase="draft", round=0)
    for l in letters:
        publish(type="call_start", label=f"draft/{alias_of[l]}", alias=alias_of[l], model=ident[l]["model"])
    await asyncio.sleep(pace * 3)
    for l in letters:
        text = result["drafts"][l]
        publish(type="call_end", label=f"draft/{alias_of[l]}", alias=alias_of[l])
        publish(type="draft", letter=l, alias=alias_of[l], text=text, words=len(text.split()))
        await asyncio.sleep(pace)

    for i, rnd in enumerate(result.get("rounds", []), 1):
        publish(type="phase", phase="roast", round=i)
        for alias, r in rnd["roasts"].items():
            publish(type="call_start", label=f"roast/{alias}", alias=alias, model="")
        await asyncio.sleep(pace * 2)
        for alias, r in rnd["roasts"].items():
            publish(type="call_end", label=f"roast/{alias}", alias=alias)
            dmg = wr.damage_from_ranking(r.get("ranking") or [], letters)
            if r.get("table_talk"):
                publish(type="table_talk", **{"from": alias}, text=str(r["table_talk"]))
            targets = r.get("roasts") or {l: r.get("raw", "") for l in letters}
            for l in sorted(targets):
                if l not in ident:
                    continue
                publish(type="roast", round=i, **{"from": alias}, target=l,
                        target_alias=alias_of[l], text=str(targets[l]).strip(),
                        tic=str((r.get("tics") or {}).get(l, "")),
                        self_roast=(alias_of[l] == alias), parsed=bool(r.get("roasts")),
                        damage=round(dmg.get(l, 0.0), 2))
                await asyncio.sleep(pace)
            if r.get("ranking"):
                publish(type="ranking", **{"from": alias}, order=r["ranking"])

        publish(type="phase", phase="revise", round=i)
        for l in sorted(rnd["revisions"]):
            text = rnd["revisions"][l]
            publish(type="revision", round=i, letter=l, alias=alias_of[l], text=text,
                    words=len(text.split()), heal=wr.HEAL)
            await asyncio.sleep(pace)

    if result.get("verdict"):
        publish(type="phase", phase="verdict", round=len(result.get("rounds", [])))
        publish(type="call_start", label="verdict", alias="judge", model="")
        await asyncio.sleep(pace * 2)
        publish(type="call_end", label="verdict", alias="judge")
        order = wr.parse_ranking(result["verdict"], letters)
        # Use the weight the run was actually scored with. Runs made before the
        # judge was weighted by ballots cast have none stored, and their scores
        # were computed with half the panel size, so fall back to that or the
        # health bars would stop matching their own scoreboard.
        weight = result.get("judge_weight")
        if weight is None:
            weight = len(letters) / 2.0
        publish(type="verdict", text=result["verdict"], order=order, judge=None,
                damage={l: round(v, 2) for l, v in wr.damage_from_ranking(
                    order, letters, weight=weight).items()})

    u = result.get("usage") or {}
    publish(type="cost", calls=u.get("calls", 0), cost=u.get("cost", 0.0),
            prompt_tokens=u.get("prompt_tokens", 0), completion_tokens=u.get("completion_tokens", 0))
    scores = result.get("scores") or {}
    publish(type="scores", scores={l: round(v, 2) for l, v in scores.items()},
            winner=max(scores, key=lambda l: scores[l]) if scores else None)
    publish(type="done", out_dir="(replay)", calls=u.get("calls", 0), cost=0.0)


# --------------------------------------------------------------------------
# run driver
# --------------------------------------------------------------------------

def room_path(name: str) -> Path:
    """Resolve a room by filename against the rooms actually present.

    The name arrives from the browser. Joining it onto a directory let a client
    read any file the process could reach: ../README.md and ../.env both parsed,
    and a YAML error echoed part of the file back. Matching against a listing
    means a path can never be constructed, so traversal has nothing to traverse.
    """
    choices = {p.name: p for p in sorted((HERE / "rooms").glob("*.yaml"))}
    chosen = choices.get(str(name or "").strip())
    if chosen is None:
        raise FileNotFoundError(
            f"no such room: {name!r}. Available: {', '.join(sorted(choices)) or 'none'}")
    return chosen


def scrub(text: object) -> str:
    """Strip local paths out of anything shown in the browser.

    Errors carried the absolute install path, which names the account on the
    machine. Nobody looking at this page needs that.
    """
    out = str(text)
    for real, mask in ((str(HERE), "<project>"), (str(Path.home()), "~")):
        out = out.replace(real, mask)
    user = os.environ.get("USER") or ""
    if len(user) > 2:
        out = out.replace(user, "<user>")
    return out


def have_key() -> bool:
    """Whether a credential is configured. Deliberately does not resolve it:
    this runs on every page load, and resolving an op:// reference prompts."""
    return wr.key_source() is not None


async def drive(cfg: dict) -> None:
    """Own the whole run so a failure becomes an event rather than a stack trace."""
    try:
        if cfg.get("demo"):
            payload = json.loads((HERE / "demo" / "sample.json").read_text())
            await replay(payload, BUS.publish, pace=float(cfg.get("pace", 0.25)))
            return
        if cfg.get("replay"):
            target = (HERE / "runs" / cfg["replay"] / "raw.json").resolve()
            if HERE / "runs" not in target.parents or not target.exists():
                raise FileNotFoundError(f"no such run: {cfg['replay']!r}")
            await replay(json.loads(target.read_text()), BUS.publish, pace=float(cfg.get("pace", 0.25)))
            return

        BUS.publish(type="phase", phase="unlock", round=0)
        await asyncio.to_thread(wr.api_key)          # may block on 1Password

        room = wr.Room.load(room_path(cfg.get("room")))
        if cfg.get("brief"):
            room.brief = cfg["brief"]
        if cfg.get("models"):
            room.panelists = [wr.Panelist(model=m) for m in cfg["models"] if m.strip()]
        if cfg.get("rounds"):
            room.rounds = int(cfg["rounds"])
        if "blind" in cfg:
            room.blind = bool(cfg["blind"])
        if "exclude_self" in cfg:
            room.exclude_self = bool(cfg["exclude_self"])
        if "judge" in cfg:
            room.judge = cfg["judge"] or None
        if cfg.get("seed") not in (None, ""):
            room.seed = int(cfg["seed"])

        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        out_dir = HERE / "runs" / f"{stamp}-{room.name}"
        await wr.run_room(room, out_dir, emit=BUS.publish)
    except asyncio.CancelledError:
        BUS.publish(type="error", message="run stopped")
        raise
    except SystemExit as exc:                      # api_key() exits on no credential
        BUS.publish(type="error", message=scrub(exc))
    except Exception as exc:                       # noqa: BLE001 - surface everything to the page
        BUS.publish(type="error", message=scrub(f"{type(exc).__name__}: {exc}"))


# --------------------------------------------------------------------------
# http
# --------------------------------------------------------------------------

async def index(request):
    return FileResponse(HERE / "static" / "index.html")


async def events(request):
    return StreamingResponse(
        BUS.stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


async def rooms(request):
    out = []
    for path in sorted((HERE / "rooms").glob("*.yaml")):
        try:
            raw = yaml.safe_load(path.read_text())
        except yaml.YAMLError:
            continue
        out.append({
            "file": path.name,
            "name": raw.get("name", path.stem),
            "default": bool(raw.get("default")),
            "brief": (raw.get("brief") or "").strip(),
            "rounds": raw.get("rounds", 1),
            "judge": raw.get("judge"),
            "blind": raw.get("blind", True),
            "panelists": [
                {"model": p["model"], "alias": p.get("alias") or p["model"].split("/")[-1]}
                for p in raw.get("panelists", [])
            ],
        })
    out.sort(key=lambda r: (not r["default"], r["name"]))   # the default room first
    past = sorted((p.parent.name for p in (HERE / "runs").glob("*/raw.json")), reverse=True)
    return JSONResponse({"rooms": out, "runs": past[:40], "have_key": have_key(),
                         "running": BUS.running})


async def start(request):
    if BUS.running:
        return JSONResponse({"error": "a run is already in progress"}, status_code=409)
    cfg = await request.json()
    if not cfg.get("demo") and not cfg.get("replay") and not have_key():
        return JSONResponse(
            {"error": "No OPENROUTER_API_KEY. Set it, or press Demo to replay a canned run."},
            status_code=400,
        )
    BUS.reset()
    BUS.task = asyncio.create_task(drive(cfg))
    return JSONResponse({"ok": True})


async def stop(request):
    if BUS.running:
        BUS.task.cancel()
    return JSONResponse({"ok": True})


_CATALOGUE: dict = {"at": 0.0, "models": []}


def shape_model(m: dict, vendors: dict[str, str]) -> dict:
    """One catalogue row, in the terms the picker displays.

    `name` is OpenRouter's own display name and is the canonical answer to
    "which model is this": 399 of 427 entries carry it as "Vendor: Model".
    Where the prefix is missing the id's own prefix stands in. The id prefix is
    also the routing key for the vendor mark, because it is the part that is
    always present and always machine-readable, whereas the display name is
    prose and disagrees with the id for 39 models (ibm-granite/... is
    "IBM: ...", ~x-ai/... is "xAI: ...").
    """
    mid = m["id"]
    slug = mid.lstrip("~").split("/")[0]
    name = (m.get("name") or "").strip()
    vendor, _, short = name.partition(": ")
    if not short:                                  # no prefix on this one
        # Learn the vendor from siblings that do carry one, rather than
        # title-casing the slug: anthropic/claude-opus-5 is named plain
        # "Claude Opus 5", while anthropic/claude-fable-latest is
        # "Anthropic: Claude Fable Latest".
        vendor, short = vendors.get(slug, slug), name or mid.split("/")[-1]
    pricing = m.get("pricing") or {}
    price = lambda k: round(float(pricing.get(k) or 0) * 1e6, 4)
    return {
        "id": mid,
        "name": name or mid,
        "vendor": vendor,
        "short": short,
        "slug": slug,                              # picks the mark and the colour
        "canonical": m.get("canonical_slug") or mid,
        "ctx": m.get("context_length") or 0,
        "price_in": price("prompt"),
        "price_out": price("completion"),
    }


async def catalogue(request):
    """Proxy OpenRouter's model list so the picker is never stale."""
    import httpx
    if time.time() - _CATALOGUE["at"] < 900 and _CATALOGUE["models"]:
        return JSONResponse({"models": _CATALOGUE["models"], "cached": True})
    try:
        async with httpx.AsyncClient(base_url=wr.API, timeout=30) as client:
            data = (await client.get("/models")).json()["data"]
    except Exception as exc:                       # noqa: BLE001
        return JSONResponse({"error": str(exc), "models": _CATALOGUE["models"]})
    # Majority vote, because a slug's models do not always agree with each
    # other: OpenRouter names x-ai/grok-4.6 "SpaceXAI" and ~x-ai/grok-latest
    # "xAI". Only the models carrying no prefix of their own consult this.
    from collections import Counter
    seen: dict[str, Counter] = {}
    for m in data:
        pre, sep, _ = (m.get("name") or "").partition(": ")
        if sep:
            seen.setdefault(m["id"].lstrip("~").split("/")[0], Counter())[pre] += 1
    vendors = {k: c.most_common(1)[0][0] for k, c in seen.items()}
    models = sorted((shape_model(m, vendors) for m in data),
                    key=lambda m: (m["vendor"].lower(), m["short"].lower()))
    _CATALOGUE.update(at=time.time(), models=models)
    return JSONResponse({"models": models, "cached": False})


app = Starlette(routes=[
    Route("/", index),
    Route("/api/events", events),
    Route("/api/rooms", rooms),
    Route("/api/models", catalogue),
    Route("/api/run", start, methods=["POST"]),
    Route("/api/stop", stop, methods=["POST"]),
    Mount("/static", StaticFiles(directory=HERE / "static"), name="static"),
])


def main() -> None:
    ap = argparse.ArgumentParser(description="Browser front end for the writers' room.")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--allow-remote", action="store_true",
                    help="permit a non-loopback --host. The page has no login and "
                         "starting a run spends money, so this is opt in.")
    args = ap.parse_args()

    if args.host not in ("127.0.0.1", "localhost", "::1") and not args.allow_remote:
        sys.exit(
            f"Refusing to bind {args.host}. There is no authentication on this "
            "server and anyone who can reach it can start a run against your "
            "OpenRouter key. Pass --allow-remote if you meant it, and put it "
            "behind something that asks for a password."
        )

    import uvicorn
    url = f"http://{args.host}:{args.port}"
    if not args.no_open:
        webbrowser.open(url)
    print(f"arena on {url}", file=sys.stderr)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
