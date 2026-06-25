from datetime import datetime

from sqlmodel import Session, SQLModel, create_engine, select

from app.db.models import Recipe, TestLoop, TestRun


def test_models_persist_and_query():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)

    with Session(engine) as s:
        r = Recipe(
            name="r1",
            description="d",
            position_mm=10.0,
            speed_mms=5.0,
            clamp_threshold_n=7.0,
            loop_count=3,
            min_force_n=1.0,
            max_force_n=10.0,
            sampling_hz=50,
            created_at=datetime.utcnow().isoformat(),
            updated_at=datetime.utcnow().isoformat(),
        )
        s.add(r)
        s.commit()
        s.refresh(r)
        assert r.id is not None

        run = TestRun(
            recipe_id=r.id,
            operator="op1",
            started_at=datetime.utcnow().isoformat(),
            status="running",
        )
        s.add(run)
        s.commit()
        s.refresh(run)

        loop = TestLoop(
            run_id=run.id,
            loop_index=1,
            started_at=datetime.utcnow().isoformat(),
            judgment="pass",
            peak_force_n=8.0,
            avg_force_n=6.0,
            hold_time_ms=300,
        )
        s.add(loop)
        s.commit()

        fetched = s.exec(select(TestLoop).where(TestLoop.run_id == run.id)).all()
        assert len(fetched) == 1
        assert fetched[0].judgment == "pass"
