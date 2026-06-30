from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import List, Optional

from sqlmodel import Session, select

from app.db.models import Comparison
from app.schemas.comparison import ComparisonCreate, ComparisonRead, ComparisonUpdate


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class ComparisonService:
    def __init__(self, session: Session):
        self.session = session

    def create(self, data: ComparisonCreate) -> ComparisonRead:
        now = _utcnow()
        blob = json.dumps({
            "run_ids": data.run_ids,
            "labels": data.labels,
            "annotations": [a.model_dump() for a in data.annotations],
            "chart_config": data.chart_config,
        })
        row = Comparison(
            name=data.name,
            description=data.description,
            data=blob,
            created_at=now,
            updated_at=now,
        )
        self.session.add(row)
        self.session.commit()
        self.session.refresh(row)
        return self._to_read(row)

    def get(self, comparison_id: int) -> Optional[ComparisonRead]:
        row = self.session.get(Comparison, comparison_id)
        if row is None:
            return None
        return self._to_read(row)

    def list_all(self) -> List[ComparisonRead]:
        rows = self.session.exec(
            select(Comparison).order_by(Comparison.updated_at.desc())
        ).all()
        return [self._to_read(r) for r in rows]

    def update(self, comparison_id: int, data: ComparisonUpdate) -> ComparisonRead:
        row = self.session.get(Comparison, comparison_id)
        if row is None:
            raise KeyError(comparison_id)

        provided = data.model_dump(exclude_unset=True)

        if "name" in provided:
            row.name = provided["name"]
        if "description" in provided:
            row.description = provided["description"]

        # Merge JSON-packed fields selectively
        if any(k in provided for k in ("run_ids", "labels", "annotations", "chart_config")):
            try:
                existing = json.loads(row.data) if row.data else {}
            except json.JSONDecodeError:
                existing = {}

            if "run_ids" in provided:
                existing["run_ids"] = provided["run_ids"]
            if "labels" in provided:
                existing["labels"] = provided["labels"]
            if "annotations" in provided:
                # annotations arrive as dicts (model_dump) from ComparisonUpdate
                existing["annotations"] = provided["annotations"]
            if "chart_config" in provided:
                existing["chart_config"] = provided["chart_config"]

            row.data = json.dumps(existing)

        row.updated_at = _utcnow()
        self.session.add(row)
        self.session.commit()
        self.session.refresh(row)
        return self._to_read(row)

    def delete(self, comparison_id: int) -> None:
        row = self.session.get(Comparison, comparison_id)
        if row is None:
            return
        self.session.delete(row)
        self.session.commit()

    def _to_read(self, row: Comparison) -> ComparisonRead:
        try:
            blob = json.loads(row.data) if row.data else {}
        except json.JSONDecodeError:
            blob = {}
        return ComparisonRead(
            id=row.id,
            name=row.name,
            description=row.description,
            run_ids=blob.get("run_ids", []),
            labels=blob.get("labels", {}),
            annotations=blob.get("annotations", []),
            chart_config=blob.get("chart_config"),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
