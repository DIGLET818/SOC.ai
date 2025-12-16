# models/incident.py
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid


@dataclass
class Incident:
    # Core IDs
    caseId: Optional[str] = None   # was: caseId: str
    title: str = ""

    # Optional meta from email
    client: Optional[str] = None
    product: Optional[str] = None
    ticket: Optional[str] = None
    offenseId: Optional[str] = None
    action: Optional[str] = None
    severity: str = "UNKNOWN"
    status: str = "open"  # use lowercase to align with TS union
    assignedAnalyst: Optional[str] = None
    priorityScore: int = 50
    source: Optional[str] = None
    body: Optional[str] = None
    lastUpdated: Optional[str] = None

    # Extra fields expected by frontend Case type
    id: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None

    aiSummary: Optional[str] = None
    mitreTechniques: Optional[List[str]] = None
    relatedAlerts: Optional[List[str]] = None
    attachments: Optional[List[Dict[str, Any]]] = None
    notes: Optional[List[Dict[str, Any]]] = None
    timeline: Optional[List[Dict[str, Any]]] = None

    def to_dict(self):
        data = asdict(self)

        # Ensure an internal id exists (used by React)
        if not data.get("id"):
            data["id"] = self.caseId or str(uuid.uuid4())

        # created/updated timestamps
        now = datetime.utcnow().isoformat()
        if not data.get("createdAt"):
            data["createdAt"] = data.get("lastUpdated") or now
        if not data.get("updatedAt"):
            data["updatedAt"] = data.get("lastUpdated") or data["createdAt"]

        # Default empty structures for detail view
        if data.get("mitreTechniques") is None:
            data["mitreTechniques"] = []
        if data.get("relatedAlerts") is None:
            data["relatedAlerts"] = []
        if data.get("attachments") is None:
            data["attachments"] = []
        if data.get("notes") is None:
            data["notes"] = []

        # Simple timeline entry that uses email body as alert details
        if data.get("timeline") is None:
            if data.get("body"):
                data["timeline"] = [
                    {
                        "id": str(uuid.uuid4()),
                        "timestamp": data["createdAt"],
                        "event": data["body"],
                        "actor": data.get("source") or "Email",
                    }
                ]
            else:
                data["timeline"] = []

        # Ensure status is lowercase to match TS union
        if isinstance(data.get("status"), str):
            data["status"] = data["status"].lower()

        # Map severity to priority bucket if needed (fallback)
        sev = (data.get("severity") or "").lower()
        if sev in ["critical", "high", "medium", "low"]:
            data["priority"] = sev
        else:
            data["priority"] = "medium"

        return data
