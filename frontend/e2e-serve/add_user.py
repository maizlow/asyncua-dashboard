"""Throwaway editor account `e2e` for the e2e-serve smoke test; its login comes from $E2E_LOGIN
(generated per run by playwright.serve.config.ts). Run from the project root."""

import asyncio
import os

from backend.users import UserStore


async def main() -> None:
    store = UserStore()
    await store.init_db()
    await store.add("e2e", os.environ["E2E_LOGIN"])


asyncio.run(main())
