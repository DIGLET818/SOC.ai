# Backend/parsers/email_to_incident.py

import re
from datetime import datetime
from collections import defaultdict


class EmailToIncidentParser:
    """
    Converts raw Gmail email messages into normalized Incident objects.

    Rules:
    - Prefer Case ID (CSxxxxxxx)
    - Fallback to Offense ID ONLY if Case ID missing
    - Ignore customer IDs
    """

    # Strict patterns
    CASE_ID_REGEX = re.compile(r"\bCase:\s*(CS\d+)\b", re.IGNORECASE)
    OFFENSE_ID_REGEX = re.compile(r"\bOffense ID:\s*(\d+)\b", re.IGNORECASE)

    def parse_email(self, email):
        subject = email.get("subject", "")
        body = email.get("body", "")

        timestamp = datetime.utcfromtimestamp(
            int(email.get("internalDate", 0)) / 1000
        ).isoformat()

        case_id = self.extract_case_id(subject) or self.extract_case_id(body)
        offense_id = self.extract_offense_id(subject) or self.extract_offense_id(body)

        # PRIMARY RULE:
        incident_id = case_id if case_id else offense_id

        stage = self.detect_stage(subject, body)

        return {
            "incidentId": incident_id,
            "caseId": case_id,
            "offenseId": offense_id,
            "title": self.extract_rule_title(subject),
            "subject": subject,
            "body": body,
            "timestamp": timestamp,
            "stage": stage,
        }

    # --------------------------------------------------
    # EXTRACTION HELPERS
    # --------------------------------------------------

    def extract_case_id(self, text: str):
        m = self.CASE_ID_REGEX.search(text)
        return m.group(1) if m else None

    def extract_offense_id(self, text: str):
        m = self.OFFENSE_ID_REGEX.search(text)
        return m.group(1) if m else None

    def extract_rule_title(self, subject: str):
        """
        Extract rule name AFTER Case update text.
        Example:
        Case: CS13801355 has been updated - 125850341 - Policy Bazaar - X-Force : Internal...
        """
        parts = subject.split(" - ", 2)
        return parts[2].strip() if len(parts) >= 3 else subject

    # --------------------------------------------------
    # STAGE DETECTION
    # --------------------------------------------------

    def detect_stage(self, subject, body):
        t = (subject + " " + body).lower()
        if "closed" in t or "resolved" in t:
            return "closed"
        if "update" in t or "updated" in t:
            return "update"
        return "opened"

    # --------------------------------------------------
    # AGGREGATION
    # --------------------------------------------------

    def aggregate_incident(self, emails):
        emails = sorted(emails, key=lambda e: e["timestamp"])

        opened = next((e for e in emails if e["stage"] == "opened"), emails[0])
        latest = emails[-1]

        return {
            "incidentId": opened["incidentId"],
            "caseId": opened.get("caseId"),
            "offenseId": opened.get("offenseId"),
            "title": opened["title"],
            "body": latest["body"],
            "status": latest["stage"],
            "lastUpdated": latest["timestamp"],
            "timeline": [
                {
                    "time": e["timestamp"],
                    "stage": e["stage"],
                    "subject": e["subject"],
                }
                for e in emails
            ],
        }

    def process_batch(self, email_list):
        grouped = defaultdict(list)

        for idx, email in enumerate(email_list):
            parsed = self.parse_email(email)

            # If neither Case nor Offense exists → ignore (SOC-safe)
            if not parsed["incidentId"]:
                continue

            grouped[parsed["incidentId"]].append(parsed)

        return [self.aggregate_incident(items) for items in grouped.values()]
