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

/** Search Jira by INC/CS token in issue summary (targeted — not capped at newest N issues). */
export async function matchJiraIssuesByTokens(
  tokens: string[],
  maxPerToken = 5
): Promise<{
  matches: Record<string, JiraIssueSearchItem[]>;
  stats?: { tokensSearched: number; tokensWithHits: number };
}> {
  if (!tokens.length) return { matches: {} };
  const res = await api.post<{
    matches: Record<string, JiraIssueSearchItem[]>;
    stats?: { tokens_searched: number; tokens_with_hits: number };
  }>("/jira-tickets/match-tokens", {
    tokens,
    max_per_token: maxPerToken,
  });
  return {
    matches: res.matches ?? {},
    stats: res.stats
      ? {
          tokensSearched: res.stats.tokens_searched,
          tokensWithHits: res.stats.tokens_with_hits,
        }
      : undefined,
  };
}
