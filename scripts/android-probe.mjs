/*
 * §9's device row has always been the one this repository cannot fill: "iOS Safari 18, Android Chrome 125, real
 * hardware". #141 asks a person with a phone, and a person with a phone is not something a work order can build.
 * But an Android emulator on a Linux runner is something a job can ask for, and #276/#267 both came out of the
 * same habit — test the "cannot" before writing it down. So this is a probe of the prerequisites, in the order
 * they fail:
 *
 *  1. does the runner expose KVM at all (without it the emulator runs in software and takes twenty minutes to
 *     boot a phone that nobody should trust a reading from),
 *  2. does the SDK the job installed produce a bootable AVD,
 *  3. is there a Chrome for Android binary in that image, and what version does it report — the row §8 wants is
 *     a *browser*, not a web view,
 *  4. can the viewer be reached from inside that browser, and can the harness see what it loaded.
 *
 * Question 4 is answered over the DevTools endpoint Chrome exposes through `adb forward`, reading `/json/list`:
 * url and title, no WebSocket client and no new dependency. It stops there on purpose. This script does not run
 * the matrix, does not measure a gesture, and does not certify anything; four of the matrix's rows have already
 * been produced by an instrument that claimed more than it measured.
 *
 * Exits 0 when the probe ran and wrote its reading — including a reading that says "no KVM" — and 2 when the
 * probe itself could not be taken.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = Number(process.env.PJSR_ANDROID_PORT || 5399);
const DEVTOOLS_PORT = 9222;
const OUT = join(root, '.spike', 'android-probe.txt');
const AVD = process.env.PJSR_AVD || 'pjsr-probe';

const lines = [];
const say = (text) => {
  lines.push(text);
  console.log(text);
};

const adb = (...args) => spawnSync('adb', args, { encoding: 'utf8', timeout: 60_000 });
const sh = (cmd) => spawnSync(cmd, { encoding: 'utf8', shell: true, timeout: 600_000 });

let ran = true;
try {
  // 1. KVM.
  const kvm = existsSync('/dev/kvm');
  const flags = (() => {
    try {
      return /-(vmx|svm)-/.test(readFileSync('/proc/cpuinfo', 'utf8')) ? 'yes' : 'no';
    } catch {
      return '(unreadable)';
    }
  })();
  say(`1. /dev/kvm          ${kvm ? 'present' : 'ABSENT'} (cpuinfo vmx/svm: ${flags})`);
  if (!kvm) {
    say(
      '   An emulator without KVM boots in software, which is a different browser session in every way that ' +
        'matters to a timing row. Recorded as the answer, not as a failure.',
    );
  }

  // 2. The SDK and an AVD.
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  say(`2. ANDROID_HOME      ${home ?? '(unset)'}`);
  if (!home) throw new Error('no Android SDK: the probe itself could not be taken');
  const avds = sh(`${join(home, 'cmdline-tools', 'latest', 'bin', 'avdmanager')} list avd`).stdout ?? '';
  say(`   existing AVDs     ${avds.includes(AVD) ? AVD : '(none named ' + AVD + ')'}`);
  const boot = sh(`adb wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done; getprop sys.boot_completed'`);
  say(`   boot              ${boot.stdout?.trim() || boot.status === 0 ? 'boot_completed=1' : `not observed (exit ${boot.status})`}`);

  // 3. The browser inside it.
  const pkg = adb('shell', 'dumpsys', 'package', 'com.android.chrome');
  const version = /versionName=([^\s]+)/.exec(pkg.stdout ?? '')?.[1] ?? '(no com.android.chrome in this image)';
  const abi = adb('shell', 'getprop', 'ro.product.cpu.abi').stdout?.trim();
  const android = adb('shell', 'getprop', 'ro.build.version.release').stdout?.trim();
  say(`3. Chrome for Android ${version} on Android ${android || '(unknown)'} (${abi || '(unknown abi)'})`);

  // 4. Reach the viewer from inside that browser and read what loaded.
  const server = await createServer({
    root: join(root, 'playground'),
    configFile: join(root, 'playground', 'vite.config.ts'),
    server: { port: APP_PORT, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await server.listen();
  const appUrl = server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${APP_PORT}/`;
  // 10.0.2.2 is the emulator's own name for the host machine.
  const deviceUrl = appUrl.replace('127.0.0.1', '10.0.2.2');
  const started = adb(
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    deviceUrl,
    '-n',
    'com.android.chrome/com.google.android.apps.chrome.Main',
  );
  say(`4. intent            ${started.stdout?.trim().split('\n')[0] || started.stderr?.trim().split('\n')[0] || '(no output)'}`);
  await new Promise((r) => setTimeout(r, 12_000));
  adb('forward', `tcp:${DEVTOOLS_PORT}`, 'localabstract:chrome_devtools_remote');
  try {
    const res = await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`);
    const tabs = await res.json();
    for (const tab of tabs.slice(0, 4)) {
      say(`   tab                ${tab.type} ${String(tab.url).slice(0, 90)} — title "${String(tab.title).slice(0, 60)}"`);
    }
    const ours = tabs.find((t) => String(t.url).includes(String(APP_PORT)));
    say(
      `   verdict            the viewer ${ours ? 'was reached from inside Chrome for Android' : 'was NOT the page Chrome had open'} ` +
        `(${tabs.length} target(s) on the DevTools endpoint)`,
    );
  } catch (error) {
    say(`   DevTools endpoint  unreadable: ${String(error.message ?? error).split('\n')[0]}`);
    say('   That is the harness answer, not the product answer: without it no matrix row could be read here at all.');
  }
  await server.close().catch(() => undefined);
} catch (error) {
  ran = false;
  say(`COULD NOT PROBE    ${String(error.message ?? error).split('\n')[0]}`);
} finally {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${lines.join('\n')}\n`);
  console.log('wrote .spike/android-probe.txt');
  if (!ran) process.exit(2);
}
