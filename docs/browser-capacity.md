# Browser capacity measurements

Measured 10 October 2026. The instrumented journeys exercise real CSV import, quality approval, rendered tables/charts, backups, restored originals, source switching and cancellation. They use disposable Chromium contexts on this Windows computer (i7-12650H, 16 logical CPUs, about 16 GiB RAM). A four-times CPU slowdown is an approximation of slower computation; RAM, storage and network still belong to this computer. These results do not certify physical phones or set new file limits.

## Import, backup and restore

Each fixture starts a fresh browser, uses automated quality approval and verifies the exact original bytes after restore. No models are loaded. The slower-CPU run produced:

| CSV fixture | Open dashboard | Backup | Restore dashboard | Sampled main-thread heap maximum | Sampled private browser memory maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 rows × 8 columns | 7.66 s | 6.92 s | 7.66 s | 22.7 MiB | 241.2 MiB |
| 10,000 rows × 8 columns | 10.03 s | 8.25 s | 14.98 s | 64.9 MiB | 341.9 MiB |
| 1,000 rows × 100 columns | 23.18 s | 8.48 s | 45.20 s | 68.4 MiB | 447.5 MiB |

All three pass functional assertions and their recorded sampling-validity policy. All 28 workers created in each journey close before browser teardown. The longest observed main-thread tasks are 5.53–5.64 seconds, with timer gaps up to 5.84 seconds, during journeys that include backup. This is a responsiveness concern even for the small fixture. The responsible operation needs profiling before choosing an optimization; these measurements alone do not establish its cause.

## Thirty sources and cancellation

At normal CPU speed, 30 synthetic CSV sources (13,770 rows total) import and finish automated review in 11.47 seconds. All 30 source switches pass: p95 501 ms, maximum 769 ms. Sampled main-thread heap reaches 77.5 MiB and private browser memory 425.8 MiB. The longest observed task is 485 ms and timer gap 494 ms. All 319 created workers close before teardown.

With the four-times CPU slowdown, the same collection completes import/review in 57.65 seconds and all 30 switches pass: p95 6.54 seconds, maximum 6.64 seconds. Sampled heap reaches 90.9 MiB and private browser memory 441.0 MiB. The longest task is 4.29 seconds and timer gap 4.60 seconds; all 387 created workers close. Maximum heap-sample gap is 2.33 seconds, within the recording's validity policy. The slower switching and visible pauses reinforce the need for physical-device acceptance.

The final slower-CPU cancellation check uses an owned HTTPS streaming server and a 36,800,069-byte CSV on disk. Cancelling the stream closes the server response and restores the import control (464 ms). Cancelling the actual CSV parser closes its worker and restores the control (230 ms). Dataset metadata, rows, original chunks and import staging all remain empty. A subsequent completed HTTPS import is reviewed and reaches the dashboard in 4.42 seconds. The server sees two responses closed, exactly one finished normally, before teardown. All nine created workers close. Counts are checked before forced teardown. A one-day self-signed certificate is accepted only in this disposable fixture context.

## Reproducing the measurements

From `frontend`, after a generation-disabled release build:

```powershell
$env:BENCHMARK_CPU_THROTTLE = '4' # use '1' for normal speed
npm.cmd run benchmark:capacity
```

The runner owns its preview server and closes it on completion/failure. It reuses an already running loopback preview without stopping that server. Output defaults to a fresh timestamped ignored directory; `BENCHMARK_OUTPUT_DIR` can select another ignored evidence directory. Use `-- --only=import`, `collection` or `cleanup` to isolate a journey. Direct benchmark scripts also reject non-loopback origins.

Heap sampling requests 100 ms intervals, but the import run actually has maximum sample gaps of 2.53–3.01 seconds. These are sampled maxima, not precise transient peaks. Main-thread heap omits workers/GPU; the separate one-second process sampler includes worker-containing browser processes but also misses peaks. Summed working sets double-count shared pages; private committed memory has a different meaning from JavaScript heap. Long-task and timer observations reset on full navigation. A sampling gap above 30 seconds invalidates timing conclusions and is recorded alongside functional results.

Page request events sometimes lack terminal events for module workers that have already closed (8–9 unmatched events per import journey, 192 in the normal collection run and 134 in the slower run). They must not be reported as proven live network connections or as complete network idleness. The owned HTTPS server separately checks actual response closure. Worker counts cover the owned page rather than every browser resource.

## Evidence and decisions

Raw reports and logs are kept outside the public source tree. The [machine-readable summary](capacity-measurements.json) records the accepted runs.

Earlier failed attempts remain there too. The first harness incorrectly treated unmatched request events as active connections and used ordinary short review assertions for throttled measurement. An overnight attempt has hours-long sampling gaps and cannot support performance conclusions. Another collection attempt has a 153-second sample gap and fails review; its cause is unresolved and its timing is invalid. The initial cancellation fixture passed a large buffer through the automation protocol, timed out while selecting the file and inflated observed browser allocations; using a real file path resolves that reproduction. No failing run is silently replaced with a passing claim.

Keep the existing admission and operation limits. The wide-source timings and long tasks justify physical-device testing and focused profiling. They do not yet justify a wholesale paged-UI rewrite, disk-backed exact operations or vector ANN. Optional semantic/model downloads, index memory and GPU behavior require separate measurements with explicit model loading; none are included here. Experimental generation stays disabled, and its quality/recovery gates remain open.
