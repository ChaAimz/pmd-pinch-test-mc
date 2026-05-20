from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlmodel import Session, select

from app.db.models import Recipe
from app.schemas.recipe import RecipeCreate, RecipeUpdate


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class RecipeService:
    def __init__(self, session: Session):
        self.session = session

    def create(self, data: RecipeCreate) -> Recipe:
        now = _utcnow()
        r = Recipe(**data.model_dump(), created_at=now, updated_at=now)
        self.session.add(r)
        self.session.commit()
        self.session.refresh(r)
        return r

    def get(self, recipe_id: int) -> Optional[Recipe]:
        return self.session.get(Recipe, recipe_id)

    def list_all(self) -> List[Recipe]:
        return list(self.session.exec(select(Recipe).order_by(Recipe.name)).all())

    def update(self, recipe_id: int, data: RecipeUpdate) -> Recipe:
        r = self.get(recipe_id)
        if r is None:
            raise KeyError(recipe_id)
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(r, k, v)
        r.updated_at = _utcnow()
        self.session.add(r)
        self.session.commit()
        self.session.refresh(r)
        return r

    def delete(self, recipe_id: int) -> None:
        r = self.get(recipe_id)
        if r is None:
            return
        self.session.delete(r)
        self.session.commit()
