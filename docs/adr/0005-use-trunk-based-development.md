# 5. Use Trunk-Based Development

Date: 2026-07-11
Status: Accepted

## Context
We need to establish a git branching strategy that aligns with continuous integration and continuous deployment goals. The main options were GitFlow (heavy branching) and Trunk-Based Development.

## Decision
We will adopt **Trunk-Based Development**, where all developers commit to short-lived feature branches and merge into a single active branch (`main`) multiple times a day.

## Consequences
- **Pros:**
  - Avoids "merge hell" by integrating code continuously.
  - Fosters a continuous integration culture where `main` is always in a deployable state.
  - Simpler mental model for branch management.
- **Cons:**
  - Requires rigorous automated testing and CI pipelines to ensure `main` is not broken by frequent merges.
  - Features that take longer than a few days must be hidden behind feature flags to allow safe partial merges.
