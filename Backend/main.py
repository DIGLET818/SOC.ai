# main.py

import json
import os
from datetime import datetime
from flask import Flask, jsonify, request, make_response
from flask_cors import CORS

# IMPORTANT:
# Temporarily disabling Gmail imports because real Gmail data
# is causing 500 errors. Will enable later.
# from email_client.gmail_client import fetch_recent_alerts
# from parsers.email_to_incident import EmailToIncidentParser
# from models.incident import Incident

STORAGE_FILE = os.path.join(os.path.dirname(__file__), "storage", "incident_store.json")

app = Flask(__name__)

# ---------------------------------------------------------------------
# CORS CONFIG (FIXED)
# ---------------------------------------------------------------------
CORS(
    app,
    resources={r"/api/*": {"origins": "*"}},
    supports_credentials=True,
    allow_headers=["Content-Type", "Authorization"],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = make_response()
        response.headers["Access-Control-Allow-Origin"] = request.headers.get("Origin", "*")
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Max-Age"] = "3600"
        return response


# ---------------------------------------------------------------------
# ROUTE: LIST ALL ROUTES
# ---------------------------------------------------------------------
@app.get("/routes")
def routes():
    return jsonify([str(rule) for rule in app.url_map.iter_rules()])


# ---------------------------------------------------------------------
# STORAGE HELPERS
# ---------------------------------------------------------------------
def load_store():
    try:
        with open(STORAGE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def save_store(data):
    os.makedirs(os.path.dirname(STORAGE_FILE), exist_ok=True)
    with open(STORAGE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ---------------------------------------------------------------------
# TEMPORARY DUMMY INCIDENTS (SAFE, NO GMAIL)
# ---------------------------------------------------------------------
DUMMY_INCIDENTS = [
    {
        "caseId": "INC-101",
        "title": "Suspicious Login Attempt",
        "severity": "High",
        "status": "Open",
        "assignedTo": "Unassigned",
        "aiPriority": "P1",
        "lastUpdated": "2025-12-10T10:32:00",
    },
    {
        "caseId": "INC-102",
        "title": "Malware Detected",
        "severity": "Medium",
        "status": "In Progress",
        "assignedTo": "Analyst A",
        "aiPriority": "P2",
        "lastUpdated": "2025-12-09T11:15:00",
    },
    {
        "caseId": "INC-103",
        "title": "Email Phishing Attempt",
        "severity": "Low",
        "status": "Closed",
        "assignedTo": "Analyst B",
        "aiPriority": "P3",
        "lastUpdated": "2025-12-08T14:10:00",
    },
]


# ---------------------------------------------------------------------
# MAIN INCIDENT LIST API (DUMMY until Gmail ready)
# ---------------------------------------------------------------------
@app.route("/api/incidents")
def api_incidents():
    """
    GET /api/incidents?from=YYYY-MM-DD&to=YYYY-MM-DD
    """

    date_from = request.args.get("from")
    date_to = request.args.get("to")

    print("Incoming request:", date_from, date_to, flush=True)

    # Convert to datetime objects
    def parse(s):
        try:
            return datetime.strptime(s, "%Y-%m-%d")
        except:
            return None

    start = parse(date_from)
    end = parse(date_to)

    if not start or not end:
        return jsonify({"error": "Invalid date format"}), 400

    filtered = []
    for inc in DUMMY_INCIDENTS:
        try:
            ts = datetime.fromisoformat(inc["lastUpdated"])
            if start <= ts <= end:
                filtered.append(inc)
        except:
            continue

    print("Returning incidents:", len(filtered), flush=True)

    # Save cache
    save_store(filtered)

    return jsonify(filtered)


# ---------------------------------------------------------------------
# INCIDENT DETAIL API
# ---------------------------------------------------------------------
@app.route("/api/incidents/<incident_id>")
def api_incident_detail(incident_id):
    incidents = load_store()
    incident = next((i for i in incidents if str(i.get("caseId")) == str(incident_id)), None)

    if not incident:
        return jsonify({"error": "Incident not found"}), 404

    return jsonify(incident)


# ---------------------------------------------------------------------
# INCIDENT CACHE API
# ---------------------------------------------------------------------
@app.route("/api/incidents/cache")
def api_incidents_cache():
    return jsonify(load_store())


# ---------------------------------------------------------------------
# START BACKEND
# ---------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
