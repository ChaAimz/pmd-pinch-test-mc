from sqlmodel import Session, SQLModel, create_engine

from app.schemas.comparison import AnnotationSchema, ComparisonCreate, ComparisonUpdate
from app.services.comparison_service import ComparisonService


def _session():
    e = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(e)
    return Session(e)


def _make_create(**kwargs) -> ComparisonCreate:
    defaults = dict(
        name="cmp-1",
        run_ids=[1, 2, 3],
        labels={"1": "Batch A", "2": "Batch B", "3": "Batch C"},
        annotations=[
            AnnotationSchema(id="ann-1", cycleIndex=0, yValue=5.5, text="peak", color="#ff0000")
        ],
    )
    defaults.update(kwargs)
    return ComparisonCreate(**defaults)


def test_create_and_get():
    svc = ComparisonService(_session())
    created = svc.create(_make_create())
    assert created.id is not None
    assert created.name == "cmp-1"
    assert created.run_ids == [1, 2, 3]
    assert created.labels == {"1": "Batch A", "2": "Batch B", "3": "Batch C"}
    assert len(created.annotations) == 1
    assert created.annotations[0].id == "ann-1"

    got = svc.get(created.id)
    assert got is not None
    assert got.run_ids == [1, 2, 3]
    assert got.labels["2"] == "Batch B"
    assert got.annotations[0].cycleIndex == 0


def test_get_missing_returns_none():
    svc = ComparisonService(_session())
    assert svc.get(999) is None


def test_list_all_ordered_by_updated_at_desc():
    svc = ComparisonService(_session())
    svc.create(_make_create(name="alpha"))
    svc.create(_make_create(name="beta"))
    # 'beta' was created later so updated_at is larger → appears first
    items = svc.list_all()
    assert [c.name for c in items] == ["beta", "alpha"]
    # Both should exist
    assert len(items) == 2


def test_update_partial_annotations_only():
    svc = ComparisonService(_session())
    created = svc.create(_make_create())

    new_ann = AnnotationSchema(id="ann-2", cycleIndex=1, yValue=3.1, text="hold", color="#00ff00")
    updated = svc.update(created.id, ComparisonUpdate(annotations=[new_ann]))

    # Annotations replaced
    assert len(updated.annotations) == 1
    assert updated.annotations[0].id == "ann-2"
    # run_ids and labels must be preserved
    assert updated.run_ids == [1, 2, 3]
    assert updated.labels == {"1": "Batch A", "2": "Batch B", "3": "Batch C"}
    # name unchanged
    assert updated.name == "cmp-1"


def test_update_partial_run_ids_only():
    svc = ComparisonService(_session())
    created = svc.create(_make_create())
    updated = svc.update(created.id, ComparisonUpdate(run_ids=[10, 20]))
    assert updated.run_ids == [10, 20]
    # annotations still intact
    assert len(updated.annotations) == 1
    assert updated.annotations[0].id == "ann-1"


def test_update_name_and_description():
    svc = ComparisonService(_session())
    created = svc.create(_make_create(description=None))
    updated = svc.update(created.id, ComparisonUpdate(name="renamed", description="new desc"))
    assert updated.name == "renamed"
    assert updated.description == "new desc"


def test_update_missing_raises_key_error():
    svc = ComparisonService(_session())
    try:
        svc.update(999, ComparisonUpdate(name="x"))
        assert False, "should have raised KeyError"
    except KeyError:
        pass


def test_delete():
    svc = ComparisonService(_session())
    created = svc.create(_make_create())
    svc.delete(created.id)
    assert svc.get(created.id) is None


def test_delete_missing_is_noop():
    svc = ComparisonService(_session())
    svc.delete(9999)  # must not raise


def test_empty_comparison_defaults():
    svc = ComparisonService(_session())
    created = svc.create(ComparisonCreate(name="minimal"))
    assert created.run_ids == []
    assert created.labels == {}
    assert created.annotations == []
