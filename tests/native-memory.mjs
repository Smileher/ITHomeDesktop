import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

// Read public articles only. Never change preferences, account lists or drafts.
const executable = path.resolve(process.env.ITHOME_MEMORY_EXE || "src-tauri/target/x86_64-pc-windows-msvc/release/ithome-desktop.exe");
const output = process.env.ITHOME_MEMORY_REPORT || "test-results/native-memory.json";
const ids = (process.env.ITHOME_MEMORY_IDS || "1031476,1031475,1031474,1031473,1031472,1031471").split(",").map(Number);
const sessionRoot = path.join(process.env.LOCALAPPDATA, "com.smileher.ithomedesktop");
async function hashes() {
  return Promise.all(["session.bin", "settings.json"].map(async (name) => {
    try { return createHash("sha256").update(await fs.readFile(path.join(sessionRoot, name))).digest("hex"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }));
}
const before = await hashes();
const port = await new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const child = spawn(executable, [], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: {
  ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
} });
const report = { executable: path.basename(executable), articleIds: ids, metric: "process-tree private working set MB; sampled after each reading step", samples: [], sessionAndSettingsUnchanged: false };
child.stderr.on("data", (chunk) => {
  const target = String(chunk).match(/ITHome WebView memory target: (\d+)/);
  if (target) report.confirmedMemoryTarget = Number(target[1]);
});
let browser;
async function sample(stage, page) {
  const command = `$taskRoot=${child.pid};$all=Get-CimInstance Win32_Process;$ids=@($taskRoot);for($i=0;$i -lt $ids.Count;$i++){ $ids+=@($all|Where-Object ParentProcessId -eq $ids[$i]|Select-Object -ExpandProperty ProcessId) };$perf=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process|Where-Object {$_.IDProcess -in $ids};[pscustomobject]@{privateMb=[math]::Round((($perf|Measure-Object WorkingSetPrivate -Sum).Sum/1MB),1);committedMb=[math]::Round((($perf|Measure-Object PrivateBytes -Sum).Sum/1MB),1);workingMb=[math]::Round((($perf|Measure-Object WorkingSet -Sum).Sum/1MB),1);processes=@($perf|ForEach-Object {$p=$all|Where-Object ProcessId -eq $_.IDProcess;$role=if($p.CommandLine -match '--type=([^ ]+)'){$Matches[1]}else{$_.Name};[pscustomobject]@{role=$role;privateMb=[math]::Round($_.WorkingSetPrivate/1MB,1)}})}|ConvertTo-Json -Compress -Depth 4`;
  const measured = spawnSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
  assert.equal(measured.status, 0, measured.stderr);
  const renderer = await page.evaluate(() => ({
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    imageSources: [...document.images].filter((image) => image.getAttribute("src")).length,
    blobImages: [...document.images].filter((image) => image.src.startsWith("blob:")).length,
    scrollFrames: window.__memoryFrames?.result || null,
  }));
  const result = { stage, ...JSON.parse(measured.stdout), ...renderer };
  report.samples.push(result);
  console.log(JSON.stringify(result));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2), "utf8");
}
try {
  let endpoint;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Native process exited; close the existing test instance first");
    try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
    if (endpoint) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.ok(endpoint);
  browser = await chromium.connectOverCDP(endpoint);
  let page;
  for (let attempt = 0; attempt < 80; attempt++) {
    page = browser.contexts()[0].pages().find((page) => /localhost|tauri\.localhost/.test(page.url()));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(page);
  await page.locator(".news-row").first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(2000);
  await sample("startup", page);
  for (const id of ids) {
    const old = await page.locator(".reader h1").textContent().catch(() => "");
    await page.locator(".global-search input").fill(`https://m.ithome.com/html/${id}.htm`);
    await page.locator(".global-search input").press("Enter");
    await page.waitForFunction((old) => { const title = document.querySelector(".reader h1"); return title && title.textContent !== old; }, old, { timeout: 30000 });
    await page.waitForTimeout(1600);
    await page.evaluate(() => {
      const state = { active: true, last: 0, intervals: [], result: null };
      window.__memoryFrames = state;
      function frame(time) {
        if (!state.active) return;
        if (state.last) state.intervals.push(time - state.last);
        state.last = time;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    for (let step = 0; step < 6; step++) {
      await page.locator(".detail-pane").evaluate((element) => { element.scrollTop += 600; });
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => {
      const state = window.__memoryFrames;
      state.active = false;
      const sorted = state.intervals.sort((a, b) => a - b);
      state.result = { frames: sorted.length, p95Ms: Math.round((sorted[Math.floor(sorted.length * 0.95)] || 0) * 10) / 10, over50Ms: sorted.filter((value) => value > 50).length };
    });
    await sample(`read-${id}`, page);
  }
  await page.getByRole("button", { name: "资讯", exact: true }).click();
  await page.waitForTimeout(5000);
  await sample("reader-closed", page);
  report.sessionAndSettingsUnchanged = JSON.stringify(before) === JSON.stringify(await hashes());
  assert.equal(report.sessionAndSettingsUnchanged, true);
  await fs.writeFile(output, JSON.stringify(report, null, 2), "utf8");
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
