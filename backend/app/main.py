from __future__ import annotations

from fastapi import FastAPI

from app.api import recipes


def build_app(test_mode: bool = False) -> FastAPI:
    app = FastAPI(title="Pinch Test MC")
    app.include_router(recipes.router)
    return app


app = build_app()
