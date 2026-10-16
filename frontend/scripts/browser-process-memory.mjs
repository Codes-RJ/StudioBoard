import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

/** Sample only process IDs reported by this owned Chromium instance. */
export async function sampleBrowserMemory(browser) {
  const session = await browser.newBrowserCDPSession();
  const samples = []; let failure; let pending; let stopped = false;
  const collect = async () => {
    if (pending || stopped) return;
    pending = (async () => {
      try {
        const processes = (await session.send('SystemInfo.getProcessInfo')).processInfo;
        const ids = processes.map(({ id }) => Number(id));
        if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid browser process IDs.');
        if (process.platform === 'win32') {
          // Chromium can retire a process between the CDP list and this lookup.
          // Missing owned PIDs must not discard valid samples for surviving PIDs.
          const command = `$ErrorActionPreference='SilentlyContinue'; Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress; exit 0`;
          const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 5000 });
          if (!stdout.trim()) return;
          const parsed = JSON.parse(stdout); const records = Array.isArray(parsed) ? parsed : [parsed];
          samples.push({ at: Date.now(), processes: records.length,
            workingSetBytes: records.reduce((sum, item) => sum + item.WorkingSet64, 0),
            privateCommittedBytes: records.reduce((sum, item) => sum + item.PrivateMemorySize64, 0) });
        } else {
          failure = 'Process-memory sampling currently implemented for Windows only.';
        }
      } catch (error) { failure = error.message; }
    })();
    await pending; pending = null;
  };
  await collect();
  const timer = setInterval(() => { void collect(); }, 1000);
  return {
    async stop() { stopped = true; clearInterval(timer); await pending; await session.detach(); },
    summary() { return { intervalMilliseconds: 1000, samples: samples.length,
      maximumSampledWorkingSetBytes: samples.length ? Math.max(...samples.map((item) => item.workingSetBytes)) : null,
      maximumSampledPrivateCommittedBytes: samples.length ? Math.max(...samples.map((item) => item.privateCommittedBytes)) : null,
      failure, boundary: 'Owned browser processes, including worker-containing renderers; sampled maxima miss transient peaks. Summed working sets double-count shared pages; private committed bytes are not JS heap.' }; },
  };
}
