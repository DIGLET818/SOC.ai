# Jira / Atlassian integration – what you need

To create Jira tasks from the Jira Tickets alerts, the app needs the following **from your side**.

## 1. Jira site URL

- **Cloud:** `https://<your-site>.atlassian.net`  
  Example: `https://mycompany.atlassian.net`
- **Server/Data Center:** your base URL, e.g. `https://jira.mycompany.com`

## 2. Project key

The short key of the Jira project where issues will be created (e.g. `SOC`, `SEC`, `PROJ`). You see it in the project URL or in project settings.

## 3. Authentication (Jira Cloud)

- **Email:** the Atlassian account email (used for API token login).
- **API token:** create one at  
  **https://id.atlassian.com/manage-profile/security/api-tokens**  
  (Use “Create API token” and paste it somewhere safe; the UI won’t show it again.)

The app will use **Basic auth**: base64(`email:api_token`).

## 4. Issue type

The type of issue to create in that project, e.g.:

- **Task**
- **Story**
- **Incident** (if your project has it)

Must match exactly the name in Jira (Project settings → Issue types).

## 5. Optional: custom fields (so sheet data appears as Jira columns)

The app maps your sheet’s **Created** date to a Jira date column, and **Incident Category** to **Labels**. New issues are created with **Priority** set to **Major**. Jira’s built-in **Created** column still shows when the ticket was created in Jira.

**From the portal (Jira Tickets page):**

| Portal field | Jira |
|--------------|------|
| **Closure_Comments** | Posted as an **issue comment** (the Comments section on the issue). If the comment API fails, the text is appended to the issue **Description** as a fallback. |
| **Closure date** | Mapped to Jira’s built-in **Due date** (`duedate`). Accepts ISO UTC (e.g. `2026-03-04T23:49:58Z`) or `YYYY-MM-DD`. |

**Start date:** To show the sheet’s **Created** date in Jira’s **Start date** column, set `JIRA_CF_START_DATE` to your Start date field ID (e.g. `customfield_10020`). To find it: Jira → Project settings → Fields, or edit an issue and inspect the Start date field in dev tools. If `JIRA_CF_START_DATE` is not set and the portal did **not** provide a **Closure date**, the sheet **Created** date is mapped to **Due date** (legacy behavior). If **Closure date** is set on the portal, it always wins for **Due date**.

To also show incident date (or other fields) in additional columns, add custom fields in your project and set these env vars to their **field IDs** (e.g. `customfield_10020`):

| Env variable | Purpose | Jira field type |
|--------------|---------|------------------|
| `JIRA_CF_INCIDENT_DATE` | Date from your sheet (e.g. incident created) | Date |
| `JIRA_CF_INCIDENT_CATEGORY` | Incident Category from sheet | Text (single line) |
| `JIRA_CF_CLOSURE_COMMENTS` | Optional duplicate of Closure_Comments in a **custom** text field (in addition to the issue **comment**) | Text |

To find field IDs: Jira → Project settings → Fields, or browser dev tools when editing an issue.

If these are not set, the app still puts **Created** and **Incident Category** into the issue **Description**; **Closure_Comments** are no longer duplicated in the description by default (they go to **Comments** instead). Setting `JIRA_CF_CLOSURE_COMMENTS` still maps closure text to that custom field if you need a column.

---

## How to configure in this app

Set these **environment variables** (e.g. in a `.env` file in the `Backend` folder or in your run configuration):

| Variable | Example | Required |
|----------|---------|----------|
| `JIRA_BASE_URL` | `https://mycompany.atlassian.net` | Yes |
| `JIRA_EMAIL` | `you@company.com` | Yes (Cloud) |
| `JIRA_API_TOKEN` | your API token | Yes (Cloud) |
| `JIRA_PROJECT_KEY` | `SOC` | Yes |
| `JIRA_ISSUE_TYPE` | `Task` | Yes |
| `JIRA_CF_START_DATE` | `customfield_10020` | No – field ID for **Start date** (sheet Created → this column); if unset, uses Due date |
| `JIRA_CF_INCIDENT_DATE` | `customfield_10020` | No – custom field for incident/source date |
| `JIRA_CF_INCIDENT_CATEGORY` | `customfield_10021` | No – custom field for Incident Category |
| `JIRA_CF_CLOSURE_COMMENTS` | `customfield_10022` | No – custom field for Closure_Comments |

Use your project’s actual custom field IDs (the numbers differ per Jira instance).

**Security:** Do not commit `.env` or any file containing the API token. The repo’s `.gitignore` already excludes `.env`.

After these are set and the backend is restarted, you can use **“Create in Jira”** on the Jira Tickets page to create one Jira task per selected alert.
