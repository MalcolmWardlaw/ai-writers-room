# Security

This is a small local tool that talks to one paid API. The whole of its
security surface is one credential and one web server bound to your own
machine. Nothing here is alarming.

If you read nothing else: fund your OpenRouter account with a small amount
rather than a large one. It is prepaid, so that balance is the entire downside
of anything going wrong with the key, and it makes the rest of this document
advice rather than a set of precautions you have to get right.

## The key

The only secret is an OpenRouter API key. It can spend money, and that is the
extent of what it can do: it cannot read your files, your email or your other
accounts.

Set it up once:

```
cp .env.example .env
# paste your key from https://openrouter.ai/keys
chmod 600 .env
uv run writers_room.py key       # confirms it resolves, prints only a mask
```

`.env` is listed in `.gitignore`. It should stay there. The `key` command never
prints the secret, so it is safe to run with someone looking over your shoulder
or in a terminal you are recording.

Three habits that cover most of the risk:

- **Fund the account small and let that be the ceiling.** OpenRouter runs on
  prepaid credit, so the money at risk is the money you have already put in,
  not your card. Put five or ten dollars in, mint the key, and the worst case
  is that a leaked key spends an amount you had already decided to spend. You
  can also cap an individual key when you create it. Either way this bounds the
  downside instead of trying to prevent it, which is why it is worth more than
  any amount of care about file permissions.
- **Keep it out of your shell history and your shell config.** Exporting a key
  in `.bashrc`, `.zshrc` or a fish universal variable puts it in a plain file
  that gets backed up, synced, and read by every process you run. A permissioned
  `.env` next to the project is easier to reason about.
- **Rotate it if it was ever somewhere it should not have been.** Rotating is a
  minute of work at the provider. It is much cheaper than deciding whether a
  particular exposure mattered.

If a key has been in a file you are unsure about, revoke it and mint a new one.
That is the whole procedure.

### Where the key is read from

In order:

1. The `OPENROUTER_API_KEY` environment variable.
2. `OPENROUTER_API_KEY` in the project's `.env`.

Whichever is found first is used, and it is resolved once per process.

## The server

`arena.py` serves a page on `127.0.0.1` and has no login. Anything that can
reach it can start a run, and a run spends money, so:

- It binds loopback by default. A different `--host` is refused unless you also
  pass `--allow-remote`, which exists so that exposing it has to be a decision
  rather than a typo.
- If you do expose it, put a reverse proxy with authentication in front. Do not
  put it on a shared machine or a public network without one.
- Room files are chosen from the ones present on disk, so a browser cannot name
  an arbitrary path, and errors sent to the page have local paths stripped out.

## What runs are stored

Finished runs are written to `runs/`, which is gitignored. They contain the
briefs you wrote and everything the models replied, in plain text. If you point
this at anything sensitive, that directory is where it will be sitting.

## Reporting something

This is a personal project rather than a supported product. If you find
something, open an issue.

## Using a secret manager instead

If you already keep credentials in a manager, `OPENROUTER_API_KEY` may be a
reference rather than a literal, and 1Password's `op://` scheme works without
any extra setup:

```
OPENROUTER_API_KEY=op://Private/OpenRouter/credential
```

Run under `op run --env-file .env -- uv run arena.py`, which resolves the file
before the process starts, or run normally and the reference is passed to
`op read` once at startup and cached for the life of the process. Checking
whether a credential exists never resolves it, so opening the page does not
trigger a prompt. For an unattended run, a service account token in
`OP_SERVICE_ACCOUNT_TOKEN` answers without prompting.

This path is optional. A permissioned `.env` is fine.
