// Named projection registry.
//
// The manifest refers to trim projections by string key rather than
// holding function references directly. This lets the code-api
// generator in Layer 3 emit stubs with trim hints without serializing
// closures, and lets the dispatcher look up the projection at call
// time without tight coupling.

import {
  attachmentSummary,
  bareListSummary,
  commentSummary,
  issueSummary,
  paginatedListSummary,
  projectSummary,
  searchSummary,
  userSummary,
  voteListSummary,
  watcherListSummary,
} from "./trim.js";

// Each projection takes the raw response and returns a compact
// summary. Typed as `unknown → unknown` at the registry boundary so
// the map can hold heterogeneous signatures; callers that know the
// shape can narrow themselves.
export type TrimFn = (input: unknown) => unknown;

export const trimRegistry = {
  // Single-entity projections.
  issue: issueSummary as TrimFn,
  search: searchSummary as TrimFn,
  comment: commentSummary as TrimFn,
  attachment: attachmentSummary as TrimFn,
  user: userSummary as TrimFn,
  project: projectSummary as TrimFn,
  // Paginated lists — count + metadata, ref carries the items.
  list: paginatedListSummary as TrimFn,
  // Bare-array lists — count only, ref carries the items.
  bareList: bareListSummary as TrimFn,
  // Specialized list shapes.
  watcherList: watcherListSummary as TrimFn,
  voteList: voteListSummary as TrimFn,
} as const;

export type TrimKey = keyof typeof trimRegistry;
