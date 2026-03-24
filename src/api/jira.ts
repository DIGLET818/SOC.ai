/**
 * Jira API – create issue from Jira Tickets alert row.
 */
import api from "./client";

export interface CreateJiraIssueParams {
  summary: string;
  description: string;
  status?: string;
  incident_category?: string;
  closure_comments?: string;
  /** Sheet/portal Created timestamp */
  created?: string;
  /** Portal Closure date (ISO or YYYY-MM-DD) → Jira Due date */
  closure_date?: string;
}

export interface JiraIssueResponse {
  id?: string;
  key?: string;
  self?: string;
}

export async function createJiraIssue(params: CreateJiraIssueParams): Promise<JiraIssueResponse> {
  return api.post<JiraIssueResponse>("/jira/issue", params);
}

export interface JiraIssueSearchItem {
  key: string;
  summary: string;
  status: string;
}

/** Fetch existing Jira issues from the project (for linking to alerts). */
export async function fetchJiraIssues(maxResults = 200): Promise<JiraIssueSearchItem[]> {
  return api.get<JiraIssueSearchItem[]>(`/jira/issues?max_results=${maxResults}`);
}
