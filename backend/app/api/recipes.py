from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.db.engine import get_session
from app.schemas.recipe import RecipeCreate, RecipeRead, RecipeUpdate
from app.services.recipe_service import RecipeService

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


@router.get("", response_model=List[RecipeRead])
def list_recipes(session: Session = Depends(get_session)):
    return RecipeService(session).list_all()


@router.post("", response_model=RecipeRead, status_code=status.HTTP_201_CREATED)
def create_recipe(data: RecipeCreate, session: Session = Depends(get_session)):
    return RecipeService(session).create(data)


@router.get("/{recipe_id}", response_model=RecipeRead)
def get_recipe(recipe_id: int, session: Session = Depends(get_session)):
    r = RecipeService(session).get(recipe_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return r


@router.put("/{recipe_id}", response_model=RecipeRead)
def update_recipe(recipe_id: int, data: RecipeUpdate, session: Session = Depends(get_session)):
    try:
        return RecipeService(session).update(recipe_id, data)
    except KeyError:
        raise HTTPException(status_code=404, detail="Recipe not found")


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe(recipe_id: int, session: Session = Depends(get_session)):
    RecipeService(session).delete(recipe_id)
    return None
