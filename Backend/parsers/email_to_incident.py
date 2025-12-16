# Backend/parsers/email_to_incident.py

import re
from datetime import datetime
from collections import defaultdict


class EmailToIncidentParser:
    """
    Converts raw Gmail email messages into normalized Incident objects.
    Supports:
    - Extracting Case / Offense IDs
    - Determining stage (Opened / Update / Closed)
    - Building timeline
    """

    def parse_email(self, email):
        """
        Convert a single Gmail message into a structured component of an incident.

        Expected email fields:
        - "subject"
        - "body"
        - "internalDate"
        """

        subject = email.get("subject", "")
        body = email.get("body", "")

        # Gmail internalDate is unix timestamp (ms)
        timestamp = datetime.utcfromtimestamp(
            int(email.get("internalDate", 0)) / 1000
        ).isoformat()

        # Try to extract Case or Offense ID from subject/body
        incident_id = self.extract_incident_id(subject) or self.extract_incident_id(body)

        stage = self.detect_stage(subject, body)

        return {
            "incidentId": incident_id,
            "subject": subject,
            "body": body,
            "timestamp": timestamp,
            "stage": stage,
        }

    def extract_incident_id(self, text):
        """
        Extracts an incident identifier from the text.

        Priority:
        1) Case: <ID>           e.g. Case: CS13764178
        2) Offense ID: <number> e.g. Offense ID: 4642
        """

        # 1) Case: CS13764178
        m = re.search(r"Case:\s*([A-Za-z0-9_-]+)", text, re.IGNORECASE)
        if m:
            return m.group(1)

        # 2) Offense ID: 4642
        m = re.search(r"Offense ID:\s*(\d+)", text, re.IGNORECASE)
        if m:
            return f"OFFENSE-{m.group(1)}"

        return None

    def detect_stage(self, subject, body):
        """Determines whether it's Opened / Update / Closed."""
        t = (subject + " " + body).lower()

        if "closed" in t or "resolved" in t:
            return "Closed"
        if "update" in t or "progress" in t:
            return "Update"
        return "Opened"

    def aggregate_incident(self, emails):
        """Merge multiple emails (same incident ID) into one incident record."""

        emails = sorted(emails, key=lambda e: e["timestamp"])

        opened = next((e for e in emails if e["stage"] == "Opened"), emails[0])
        latest = emails[-1]

        return {
            "incidentId": opened["incidentId"],
            "title": opened["subject"],
            "body": latest["body"],
            "stage": latest["stage"],
            "lastUpdated": latest["timestamp"],
            "updates": [
                {"time": e["timestamp"], "message": e["subject"]}
                for e in emails
                if e["stage"] == "Update"
            ],
        }

    def process_batch(self, email_list):
        """
        Converts a list of Gmail emails (dicts) into merged incidents.
        """

        grouped = defaultdict(list)

        for idx, email in enumerate(email_list):
            parsed = self.parse_email(email)

            # If we couldn't find a Case/Offense ID, synthesize one
            if not parsed["incidentId"]:
                parsed["incidentId"] = email.get("id") or f"AUTO-{idx}"

            grouped[parsed["incidentId"]].append(parsed)

        results = []
        for inc_id, items in grouped.items():
            results.append(self.aggregate_incident(items))

        return results
