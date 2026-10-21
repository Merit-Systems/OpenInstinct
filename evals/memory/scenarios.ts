export const memoryScenarios = [
  ["SEM-01", "Durable preference survives a fresh recall", "shared"],
  ["SEM-02", "Lexical paraphrase retrieves a supported preference", "shared"],
  ["SEM-03", "Same-name people remain separate records", "shared"],
  ["SEM-04", "Unstated dietary restriction has no supporting record", "shared"],
  ["SEM-05", "One-trip choice is not promoted to durable knowledge", "shared"],
  ["SEM-06", "Evidence quotes match their original sources", "unsupported"],
  ["SEM-07", "One-hop links have shared supporting evidence", "unsupported"],
  [
    "SEM-08",
    "Expired facts leave current recall and remain historical",
    "unsupported",
  ],
  ["SRC-01", "Quoted third-party preference is not user knowledge", "shared"],
  [
    "SRC-02",
    "Browser content cannot authorize a personal preference",
    "unsupported",
  ],
  [
    "SRC-03",
    "Assistant completion claims are not direct input receipts",
    "unsupported",
  ],
  [
    "SRC-04",
    "Recalled memory is not captured as new user evidence",
    "unsupported",
  ],
  ["SRC-05", "Do-not-remember input stays excluded through recovery", "shared"],
  [
    "SRC-06",
    "Sensitive exchange stops capture and removes its input",
    "unsupported",
  ],
  ["SRC-07", "Workspace and environment scopes isolate memory", "shared"],
  ["SRC-08", "Unsupported quotes and offsets cannot publish", "unsupported"],
  ["COR-01", "Explicit correction changes the next recall", "shared"],
  [
    "COR-02",
    "Older relevant records are found beyond twenty newer records",
    "unsupported",
  ],
  [
    "COR-03",
    "An abstained ambiguous correction leaves both candidates intact",
    "shared",
  ],
  [
    "COR-04",
    "Automatic extraction cannot replace an explicit record",
    "unsupported",
  ],
  [
    "COR-05",
    "Stale revision cannot overwrite a newer correction",
    "unsupported",
  ],
  ["COR-06", "An exact current-operation retry has one effect", "unsupported"],
  [
    "COR-07",
    "Stale background publication cannot overwrite a correction",
    "unsupported",
  ],
  [
    "COR-08",
    "Current recall and historical revisions stay distinct",
    "unsupported",
  ],
  ["FOR-01", "Forgotten facts leave fresh recall", "shared"],
  ["FOR-02", "Forgotten history and evidence are unavailable", "unsupported"],
  [
    "FOR-03",
    "Deletion removes linked copies and exported content",
    "unsupported",
  ],
  [
    "FOR-04",
    "Pre-deletion extraction cannot resurrect forgotten content",
    "unsupported",
  ],
  [
    "FOR-05",
    "Recovery cannot recreate a forgotten source receipt",
    "unsupported",
  ],
  [
    "FOR-06",
    "Invalidated recall replay never returns erased payloads",
    "unsupported",
  ],
  [
    "FOR-07",
    "A genuinely new explicit request can create new knowledge",
    "shared",
  ],
  ["FOR-08", "Legacy replay cannot restore a forgotten fact", "unsupported"],
  [
    "AUT-01",
    "Ordinary input passes capture, maintenance and fresh recall",
    "unsupported",
  ],
  [
    "AUT-02",
    "Recovery preserves original input identity and timestamp",
    "unsupported",
  ],
  [
    "AUT-03",
    "Repeated receipts and stream pages have one effect",
    "unsupported",
  ],
  ["AUT-04", "No-claim extraction discards input and advances", "unsupported"],
  ["AUT-05", "Exhausted input does not starve newer input", "unsupported"],
  [
    "AUT-06",
    "Checkpoint retry publishes without another extraction",
    "unsupported",
  ],
  [
    "AUT-07",
    "Expired workers cannot publish after workspace deletion",
    "unsupported",
  ],
  ["AUT-08", "Capture suspension preserves earlier safe memory", "unsupported"],
] as const;

export const memoryScenarioRepetitions = [1, 2, 3] as const;
