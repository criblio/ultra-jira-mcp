// Reference + summary shapes returned by the response sandbox.
//
// `Ref<T>` is what Layer 3 (code-api) stubs return: a trimmed projection
// (`summary`) the agent can reason over for free, plus a filesystem `ref`
// pointing at the full JSON for when it needs the details.
//
// `SandboxResult<T>` is the Layer 1 primitive — it carries the same fields
// plus bookkeeping (hash, fullSize) used by the sandbox module itself.

export interface SandboxResult<TSummary> {
  summary: TSummary;
  ref: string;
  hash: string;
  fullSize: number;
  fetchedAt: string;
}

export type Ref<TSummary> = SandboxResult<TSummary>;

export type SummarizeFn<TInput, TSummary> = (input: TInput) => TSummary;

export interface SandboxOpts<TInput, TSummary> {
  kind: string;
  summarize: SummarizeFn<TInput, TSummary>;
}
