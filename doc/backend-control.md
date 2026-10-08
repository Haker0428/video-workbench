# Backend control and switching

## Current profiles

The workbench stores a list of backend profiles and one active backend. A profile contains:

- stable id, display name and adapter kind;
- HTTP base URL and optional bearer key;
- SSH target plus start/stop commands;
- advertised generation modes.

Sol-H3 Spark is configured for `http://100.64.52.42:30010` and uses the user's existing `spark`
SSH host. GB10 is present as an unconfigured profile so switching behavior can be built and tested
without inventing a server command that does not exist yet.

## Sol-H3 remote manager

Install `scripts/remote/sol_h3_service.sh` as:

```text
/home/nvidia/sol-h3-runtime/bin/workbench-sol-h3
```

The workbench invokes `start` and `stop` over SSH. The manager:

- adopts an already-running service on port 30010;
- starts Hybrid T2VA/FL2VA on the Spark Tailscale address;
- stores a PID and controls the whole process group;
- allows up to 60 seconds for graceful shutdown before a forced stop;
- creates a unique output directory and log for every launch.
- restarts a live PID when `/health` reports an unrecoverable service error;
- starts Stage1 with resident-service compile cache limits so varied prompt lengths do not
  exhaust FastVideo's batch-oriented default after only a few requests.

## GB10 server contract

The current GB10 implementation is a batch runner (`scripts/run.py` plus
`models/minimax_h3/GB10/run_minimax_h3_gpu.sh`), not an HTTP server. Do not point the workbench at
the batch runner directly. A GB10 adapter server should implement the same minimum contract:

```text
GET  /health
POST /v1/videos
GET  /v1/videos/{id}
GET  /v1/videos/{id}/content
```

Recommended optional endpoints are `GET /v1/capabilities` and the task-first upload APIs used by
Sol-H3. `/health` should expose `status`, `task`, `queue_depth`, and the startup object with phase,
percent, elapsed time, estimated total, and estimated remaining time.

Once the adapter exists, fill the GB10 profile's API URL and SSH start/stop commands. No frontend
change is required if the contract is compatible. If the JSON differs, add a new adapter keyed by
the profile's `kind` field while keeping the UI and task provenance unchanged.
