"""Editor accounts and sessions (decision 13 in docs/EDITOR-PLAN.md).

Two local accounts (Johan and a colleague), no roles and no signup page. Passwords are stored as
argon2id hashes in SQLite (table editor_users); sessions are random tokens of which only the sha256
is stored (table editor_sessions), sent as an HttpOnly, SameSite=Strict cookie.

    python -m backend.users add johan      # asks for the password twice
    python -m backend.users passwd johan
    python -m backend.users list
    python -m backend.users remove johan
"""

from __future__ import annotations

import hashlib
import re
import secrets
import sys
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

NAME_RE = re.compile(r"^[a-z][a-z0-9_.-]{1,31}$")
MIN_PASSWORD = 10
SESSION_HOURS = 12

_hasher = PasswordHasher()
# Verified against when the user doesn't exist, so a wrong name takes as long as a wrong password
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class UserStore:
    def __init__(self, db=None):
        self._db = db

    @property
    def db(self):
        if self._db is None:
            from backend.opc.database import default_database

            self._db = default_database()
        return self._db

    async def init_db(self) -> None:
        def _init(c):
            c.execute("CREATE TABLE IF NOT EXISTS editor_users (name TEXT PRIMARY KEY, hash TEXT NOT NULL, created_ts TEXT NOT NULL)")
            c.execute(
                "CREATE TABLE IF NOT EXISTS editor_sessions (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, created_ts TEXT NOT NULL, expires_ts TEXT NOT NULL)"
            )
            c.commit()

        await self.db.run_async(_init)

    # ---------------------------------------------------------------- accounts

    async def add(self, name: str, password: str) -> None:
        if not NAME_RE.match(name):
            raise ValueError("namnet: 2–32 tecken, små bokstäver, siffror, . _ -, börjar med en bokstav")
        if len(password) < MIN_PASSWORD:
            raise ValueError(f"lösenordet måste ha minst {MIN_PASSWORD} tecken")
        h = _hasher.hash(password)

        def _ins(c):
            if c.execute("SELECT 1 FROM editor_users WHERE name = ?", (name,)).fetchone():
                raise ValueError(f"användaren '{name}' finns redan (byt lösenord med passwd)")
            c.execute("INSERT INTO editor_users (name, hash, created_ts) VALUES (?, ?, ?)", (name, h, _now().isoformat(timespec="seconds")))
            c.commit()

        await self.db.run_async(_ins)

    async def set_password(self, name: str, password: str) -> None:
        if len(password) < MIN_PASSWORD:
            raise ValueError(f"lösenordet måste ha minst {MIN_PASSWORD} tecken")
        h = _hasher.hash(password)

        def _upd(c):
            if c.execute("UPDATE editor_users SET hash = ? WHERE name = ?", (h, name)).rowcount == 0:
                raise ValueError(f"användaren '{name}' finns inte")
            c.execute("DELETE FROM editor_sessions WHERE name = ?", (name,))  # log out everywhere
            c.commit()

        await self.db.run_async(_upd)

    async def remove(self, name: str) -> bool:
        def _del(c):
            n = c.execute("DELETE FROM editor_users WHERE name = ?", (name,)).rowcount
            c.execute("DELETE FROM editor_sessions WHERE name = ?", (name,))
            c.commit()
            return n > 0

        return await self.db.run_async(_del)

    async def names(self) -> list[str]:
        rows = await self.db.run_async(lambda c: c.execute("SELECT name FROM editor_users ORDER BY name").fetchall())
        return [r[0] for r in rows]

    async def verify(self, name: str, password: str) -> bool:
        row = await self.db.run_async(lambda c: c.execute("SELECT hash FROM editor_users WHERE name = ?", (name,)).fetchone())
        try:
            _hasher.verify(row[0] if row else _DUMMY_HASH, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
        if row is None:
            return False
        if _hasher.check_needs_rehash(row[0]):
            new = _hasher.hash(password)
            await self.db.run_async(lambda c: (c.execute("UPDATE editor_users SET hash = ? WHERE name = ?", (new, name)), c.commit()))
        return True

    # ---------------------------------------------------------------- sessions

    async def create_session(self, name: str) -> str:
        token = secrets.token_urlsafe(32)
        now = _now()

        def _ins(c):
            c.execute("DELETE FROM editor_sessions WHERE expires_ts < ?", (now.isoformat(),))
            c.execute(
                "INSERT INTO editor_sessions (token_hash, name, created_ts, expires_ts) VALUES (?, ?, ?, ?)",
                (_token_hash(token), name, now.isoformat(), (now + timedelta(hours=SESSION_HOURS)).isoformat()),
            )
            c.commit()

        await self.db.run_async(_ins)
        return token

    async def session_user(self, token: str | None) -> str | None:
        if not token:
            return None
        row = await self.db.run_async(
            lambda c: c.execute(
                "SELECT s.name, s.expires_ts FROM editor_sessions s JOIN editor_users u ON u.name = s.name WHERE s.token_hash = ?",
                (_token_hash(token),),
            ).fetchone()
        )
        if row is None or datetime.fromisoformat(row[1]) < _now():
            return None
        return row[0]

    async def delete_session(self, token: str | None) -> None:
        if token:
            await self.db.run_async(lambda c: (c.execute("DELETE FROM editor_sessions WHERE token_hash = ?", (_token_hash(token),)), c.commit()))


_store: UserStore | None = None


def get_user_store() -> UserStore:
    global _store
    if _store is None:
        _store = UserStore()
    return _store


def _cli(argv: list[str]) -> int:
    import asyncio
    import getpass

    store = UserStore()

    def ask() -> str:
        a = getpass.getpass("Lösenord: ")
        if a != getpass.getpass("Upprepa: "):
            raise ValueError("lösenorden är olika")
        return a

    async def run() -> int:
        await store.init_db()
        cmd, args = (argv[0], argv[1:]) if argv else ("list", [])
        if cmd == "list" and not args:
            for n in await store.names():
                print(n)
            return 0
        if cmd == "add" and len(args) == 1:
            await store.add(args[0], ask())
            print(f"Användaren '{args[0]}' är skapad. Logga in på /editor/.")
            return 0
        if cmd == "passwd" and len(args) == 1:
            await store.set_password(args[0], ask())
            print(f"Lösenordet för '{args[0]}' är bytt (alla sessioner utloggade).")
            return 0
        if cmd == "remove" and len(args) == 1:
            print("Borttagen." if await store.remove(args[0]) else f"Användaren '{args[0]}' finns inte.")
            return 0
        print(__doc__.split("\n\n")[-1], file=sys.stderr)
        return 2

    try:
        return asyncio.run(run())
    except ValueError as e:
        print(f"FEL: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(_cli(sys.argv[1:]))
