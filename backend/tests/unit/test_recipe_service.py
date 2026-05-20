from sqlmodel import Session, SQLModel, create_engine

from app.schemas.recipe import RecipeCreate, RecipeUpdate
from app.services.recipe_service import RecipeService


def _session():
    e = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(e)
    return Session(e)


def test_create_and_get_recipe():
    s = _session()
    svc = RecipeService(s)
    created = svc.create(RecipeCreate(
        name="r1",
        position_mm=10.0,
        speed_mms=5.0,
        clamp_threshold_n=7.0,
        loop_count=3,
    ))
    assert created.id is not None
    got = svc.get(created.id)
    assert got.name == "r1"


def test_update_recipe():
    s = _session()
    svc = RecipeService(s)
    r = svc.create(RecipeCreate(
        name="r2", position_mm=10.0, speed_mms=5.0, clamp_threshold_n=7.0, loop_count=3
    ))
    updated = svc.update(r.id, RecipeUpdate(loop_count=10))
    assert updated.loop_count == 10


def test_delete_recipe():
    s = _session()
    svc = RecipeService(s)
    r = svc.create(RecipeCreate(
        name="r3", position_mm=10.0, speed_mms=5.0, clamp_threshold_n=7.0, loop_count=3
    ))
    svc.delete(r.id)
    assert svc.get(r.id) is None


def test_list_recipes_sorted():
    s = _session()
    svc = RecipeService(s)
    svc.create(RecipeCreate(name="b", position_mm=1, speed_mms=1, clamp_threshold_n=1, loop_count=1))
    svc.create(RecipeCreate(name="a", position_mm=1, speed_mms=1, clamp_threshold_n=1, loop_count=1))
    items = svc.list_all()
    assert [r.name for r in items] == ["a", "b"]
