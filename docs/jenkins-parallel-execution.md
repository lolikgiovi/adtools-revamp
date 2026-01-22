# Jenkins Parallel Execution Analysis

This document analyzes the findings from the Jenkins parallel job execution PoC and provides implementation guidance for the Run Query feature.

## Background

**Question:** Can we trigger multiple Jenkins jobs of the same type in parallel via the API?

**Initial Assumption:** Jenkins limits one job per user to one job at a time.

**Finding:** This assumption is **partially incorrect**. The limitation is not per-user, but based on:
1. Jenkins job configuration ("Execute concurrent builds if necessary")
2. The "Quiet Period" queue mechanism

## PoC Location

- Script: [backend-workers/scripts/jenkins-parallel-poc.js](../backend-workers/scripts/jenkins-parallel-poc.js)
- Run: `cd backend-workers && npm run poc:jenkins-parallel`
- Sequential mode: `npm run poc:jenkins-parallel -- --sequential`

## Key Findings

### 1. True Parallel Triggers Are Deduplicated

When triggering the same job multiple times within milliseconds:

```
[Job 1] Triggered! Queue URL: .../queue/item/1330914/api/json
[Job 2] ⚠️  Queue item already exists: /queue/item/1330914
[Job 3] ⚠️  Queue item already exists: /queue/item/1330914

Build numbers: 37582, 37582, 37582  ← All same build!
```

**Result:** All 3 triggers resulted in the **same single build**. Jenkins detected duplicate requests and combined them.

### 2. The Quiet Period Mechanism

Jenkins has a configurable "Quiet Period" (5 seconds on our instance). During this time:

```
[Job 1] Waiting: In the quiet period. Expires in 4.9 sec
[Job 1] Waiting: In the quiet period. Expires in 3.9 sec
...
[Job 1] Build started: #61955
```

- Job sits in **queue** during quiet period
- Subsequent identical triggers are **deduplicated** into the same queue item
- Once quiet period expires, job **starts building**
- After job starts, new triggers create **new queue items**

### 3. Sequential-Trigger, Parallel-Execution Works

When we wait for each job to **start** (not finish) before triggering the next:

```
[Job 1] Triggered → wait ~6s → Build #61955 STARTED
[Job 2] Triggered → wait ~6s → Build #61956 STARTED
[Job 3] Triggered → Build #61957 STARTED

Build numbers: 61955, 61956, 61957  ← Different builds!
```

**Result:** All 3 jobs run **simultaneously** after sequential triggering.

## Jenkins Queue States

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   QUEUED    │ ──► │  BUILDING   │ ──► │  COMPLETE   │
│ (quiet      │     │ (running)   │     │ (SUCCESS/   │
│  period)    │     │             │     │  FAILURE)   │
└─────────────┘     └─────────────┘     └─────────────┘
      │                   │
      │ Duplicate         │ New trigger
      │ triggers get      │ creates new
      │ deduplicated      │ queue item ✓
      ▼                   ▼
```

## API Behavior

### Trigger Endpoint

```
POST /job/{JOB_NAME}/buildWithParameters
```

**Response when new queue item created:**
- Status: `201 Created`
- Header: `Location: /queue/item/123456/`

**Response when duplicate detected (queue item exists):**
- Status: `200 OK`
- Body: `Queue item exists. For details check /queue/item/123456/api/json`
- No `Location` header

### Queue Polling Endpoint

```
GET /queue/item/{ID}/api/json
```

**Response while in quiet period:**
```json
{
  "why": "In the quiet period. Expires in 4.9 sec",
  "executable": null
}
```

**Response when build started:**
```json
{
  "executable": {
    "number": 61955,
    "url": "http://jenkins/job/JOB_NAME/61955/"
  }
}
```

## Implementation Pattern

### The Solution: Sequential-Trigger, Parallel-Execution

```javascript
async function triggerParallelJobs(jobs) {
  const builds = [];
  
  for (const job of jobs) {
    // 1. Trigger the job
    const queueUrl = await triggerJob(job);
    
    // 2. Wait for job to START (leave queue)
    const buildInfo = await pollUntilStarted(queueUrl);
    builds.push(buildInfo);
    
    // 3. Job is now BUILDING - trigger next immediately
    // Previous job continues running in background
  }
  
  // All jobs now running in parallel!
  return builds;
}

async function pollUntilStarted(queueUrl) {
  while (true) {
    const response = await fetch(queueUrl);
    const data = await response.json();
    
    if (data.executable) {
      // Job has started building
      return {
        buildNumber: data.executable.number,
        buildUrl: data.executable.url
      };
    }
    
    if (data.cancelled) {
      throw new Error('Job was cancelled');
    }
    
    // Still in queue - wait and retry
    await sleep(1000);
  }
}
```

### Timeline Example (3 Jobs)

```
Time    Job 1           Job 2           Job 3
─────────────────────────────────────────────────────
0s      TRIGGER
1-5s    [quiet period]
6s      STARTED ────────► TRIGGER
7-11s   RUNNING          [quiet period]
12s     RUNNING          STARTED ────────► TRIGGER
13-17s  RUNNING          RUNNING          [quiet period]
18s     RUNNING          RUNNING          STARTED
19s+    RUNNING          RUNNING          RUNNING
                    (all 3 running in parallel)
```

**Total trigger time:** ~18 seconds for 3 jobs  
**All jobs running simultaneously:** ✅ Yes

## Comparison: Parallel vs Sequential Trigger

| Approach | Trigger Time | Parallel Execution | Builds Created |
|----------|--------------|-------------------|----------------|
| True parallel (Promise.all) | ~50ms | ❌ Deduplicated | 1 |
| Sequential-trigger | ~6s per job | ✅ Yes | N |
| Wait for completion | Job duration | ❌ No | N |

## Handling the "Queue Item Exists" Response

When Jenkins returns "Queue item exists", you can either:

1. **Treat as error** - Fail the parallel attempt
2. **Extract existing queue URL** - Share the same build (current PoC behavior)
3. **Retry after delay** - Wait and try again

```javascript
const response = await fetch(triggerUrl, { method: 'POST', ... });

if (!response.headers.get('Location')) {
  const body = await response.text();
  const match = body.match(/\/queue\/item\/(\d+)/);
  
  if (match) {
    // Queue item exists - job already queued
    console.log('Job already in queue, waiting for it to start...');
    // Option: wait for it to start, then trigger again
  }
}
```

## Configuration Requirements

### Jenkins Job Settings

For optimal parallel execution, verify these settings on the Jenkins job:

1. **Quiet Period**: Note the value (default varies, ours is 5s)
2. **Execute concurrent builds if necessary**: 
   - If enabled: True parallel triggers work
   - If disabled: Use sequential-trigger pattern

### Executor Availability

Parallel execution requires available executors:
- Check: Manage Jenkins → Nodes → # of executors
- Each concurrent build needs one executor
- If no executors available, jobs queue until one frees up

## Run Query Implementation Plan

### Current Behavior
- Single job trigger
- Wait for completion
- Display logs

### Proposed Parallel Behavior

```
User provides N queries (or split large query into chunks)
                │
                ▼
        ┌───────────────┐
        │ Trigger Job 1 │
        └───────┬───────┘
                │ poll until STARTED
                ▼
        ┌───────────────┐
        │ Trigger Job 2 │
        └───────┬───────┘
                │ poll until STARTED
                ▼
        ┌───────────────┐
        │ Trigger Job N │
        └───────┬───────┘
                │
                ▼
    ┌───────────────────────┐
    │ All jobs RUNNING      │
    │ Stream logs from all  │
    │ Show combined status  │
    └───────────────────────┘
```

### UI Considerations

1. **Progress indicator**: Show which job is being triggered
2. **Log streaming**: Tab per job or combined view
3. **Status tracking**: Individual status per build
4. **Cancel handling**: Ability to cancel individual or all jobs

## Summary

| Question | Answer |
|----------|--------|
| Can we trigger parallel jobs? | Yes, with sequential-trigger pattern |
| Why do parallel API calls fail? | Jenkins deduplicates during quiet period |
| Do we need to wait for job completion? | No, only until job STARTS |
| How long to wait between triggers? | Poll queue until `executable` appears (~5-7s) |
| Can jobs run simultaneously? | Yes, once all are triggered and started |

## References

- [Jenkins Remote Access API](https://www.jenkins.io/doc/book/using/remote-access-api/)
- [Jenkins Quiet Period](https://www.jenkins.io/doc/book/using/quiet-period/)
- [PoC Script](../backend-workers/scripts/jenkins-parallel-poc.js)
- [Jenkins Runner Docs](./jenkins-runner.md)
