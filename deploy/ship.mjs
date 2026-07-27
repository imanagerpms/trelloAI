/**
 * Sync locale → Scaleway via tar+ssh (Windows-friendly), poi pm2 restart.
 *
 * Config: deploy/ship.config.json + override deploy/ship.local.json
 *
 * Uso:
 *   node deploy/ship.mjs
 *   node deploy/ship.mjs --watch
 *   node deploy/ship.mjs --env          # copia .env una volta
 *   node deploy/ship.mjs --bootstrap    # lancia bootstrap.sh remoto
 */
import { readFileSync, existsSync, createReadStream, watch as fsWatch } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadConfig() {
  const base = JSON.parse(
    readFileSync(join(__dirname, "ship.config.json"), "utf8")
  );
  const localPath = join(__dirname, "ship.local.json");
  if (existsSync(localPath)) {
    Object.assign(base, JSON.parse(readFileSync(localPath, "utf8")));
  }
  if (!base.host) {
    throw new Error(
      "Manca host in deploy/ship.local.json — crea il file con { \"host\": \"IP\" }"
    );
  }
  return base;
}

function sshTarget(cfg) {
  return `${cfg.user || "root"}@${cfg.host}`;
}

function sshArgs(cfg, remoteCmd) {
  const args = ["-o", "StrictHostKeyChecking=accept-new"];
  if (cfg.identityFile) args.push("-i", cfg.identityFile);
  args.push(sshTarget(cfg), remoteCmd);
  return args;
}

async function ssh(cfg, remoteCmd) {
  const { stdout, stderr } = await execFileAsync("ssh", sshArgs(cfg, remoteCmd), {
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.pipe ? ["pipe", "inherit", "inherit"] : "inherit",
      shell: opts.shell || false,
      cwd: opts.cwd || root,
      env: process.env,
    });
    if (opts.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))
    );
  });
}

async function syncCode(cfg) {
  const remote = cfg.remotePath || "/opt/trelloai";
  const excludes = (cfg.exclude || [])
    .map((e) => `--exclude=${e}`)
    .join(" ");

  console.log(`→ sync ${sshTarget(cfg)}:${remote}`);

  // tar locale | ssh tar remoto (funziona su Windows se tar+ssh in PATH)
  const files = [
    "src",
    "config",
    "rules",
    "package.json",
    "package-lock.json",
    "AGENTS.md",
    "deploy",
    ".cursor",
  ].filter((p) => existsSync(join(root, p)));

  await new Promise((resolve, reject) => {
    const tar = spawn(
      "tar",
      [
        "-czf",
        "-",
        ...((cfg.exclude || []).flatMap((e) => ["--exclude", e])),
        ...files,
      ],
      { cwd: root, stdio: ["ignore", "pipe", "inherit"] }
    );
    const remoteCmd = `mkdir -p ${remote} && tar -xzf - -C ${remote}`;
    const sshProc = spawn("ssh", sshArgs(cfg, remoteCmd), {
      stdio: ["pipe", "inherit", "inherit"],
    });
    tar.stdout.pipe(sshProc.stdin);
    tar.on("error", reject);
    sshProc.on("error", reject);
    let tarCode = null;
    let sshCode = null;
    const done = () => {
      if (tarCode === null || sshCode === null) return;
      if (tarCode === 0 && sshCode === 0) resolve();
      else reject(new Error(`sync failed tar=${tarCode} ssh=${sshCode}`));
    };
    tar.on("close", (c) => {
      tarCode = c;
      done();
    });
    sshProc.on("close", (c) => {
      sshCode = c;
      done();
    });
  });
}

async function remoteInstallAndRestart(cfg) {
  const remote = cfg.remotePath || "/opt/trelloai";
  console.log("→ npm install + pm2 restart");
  await ssh(
    cfg,
    `cd ${remote} && npm install --omit=dev && (pm2 describe trelloai >/dev/null 2>&1 && pm2 restart trelloai --update-env || pm2 start src/telegram-bot.js --name trelloai --cwd ${remote}) && pm2 save`
  );
}

async function shipEnv(cfg) {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) throw new Error("Manca .env locale");
  const remote = cfg.remotePath || "/opt/trelloai";
  console.log("→ copia .env (una tantum)");
  await run("scp", [
    "-o",
    "StrictHostKeyChecking=accept-new",
    ...(cfg.identityFile ? ["-i", cfg.identityFile] : []),
    envPath,
    `${sshTarget(cfg)}:${remote}/.env`,
  ]);
  // append PUBLIC_BASE_URL if missing
  const base = `https://${String(cfg.host).replace(/\./g, "-")}.sslip.io`;
  await ssh(
    cfg,
    `cd ${remote} && grep -q '^PUBLIC_BASE_URL=' .env || echo 'PUBLIC_BASE_URL=${base}' >> .env; grep -q '^OCTORATE_OAUTH_REDIRECT_URI=' .env || echo 'OCTORATE_OAUTH_REDIRECT_URI=${base}/oauth/callback' >> .env; grep -q '^PUBLIC_HTTP_PORT=' .env || echo 'PUBLIC_HTTP_PORT=8787' >> .env`
  );
}

async function bootstrap(cfg) {
  const remote = cfg.remotePath || "/opt/trelloai";
  console.log("→ upload bootstrap + run");
  await ssh(cfg, `mkdir -p ${remote}/deploy`);
  await run("scp", [
    "-o",
    "StrictHostKeyChecking=accept-new",
    ...(cfg.identityFile ? ["-i", cfg.identityFile] : []),
    join(__dirname, "bootstrap.sh"),
    `${sshTarget(cfg)}:${remote}/deploy/bootstrap.sh`,
  ]);
  await ssh(
    cfg,
    `chmod +x ${remote}/deploy/bootstrap.sh && PUBLIC_IP=${cfg.host} bash ${remote}/deploy/bootstrap.sh ${cfg.host}`
  );
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function watch(cfg) {
  console.log("Watch attivo — Ctrl+C per uscire");
  let busy = false;
  let pending = false;
  const runShip = async () => {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      await syncCode(cfg);
      await remoteInstallAndRestart(cfg);
      console.log("✓ ship ok", new Date().toLocaleTimeString());
    } catch (e) {
      console.error("ship error:", e.message);
    } finally {
      busy = false;
      if (pending) {
        pending = false;
        runShip();
      }
    }
  };
  const onChange = debounce(runShip, 600);
  const watchRoots = ["src", "deploy", ".cursor", "package.json"].map((p) =>
    join(root, p)
  );
  for (const p of watchRoots) {
    if (!existsSync(p)) continue;
    fsWatch(p, { recursive: true }, () => onChange());
  }
  await runShip();
}

const args = process.argv.slice(2);
const cfg = loadConfig();

try {
  if (args.includes("--bootstrap")) {
    await bootstrap(cfg);
  } else if (args.includes("--env")) {
    await shipEnv(cfg);
    await remoteInstallAndRestart(cfg);
  } else if (args.includes("--watch")) {
    await watch(cfg);
  } else {
    await syncCode(cfg);
    await remoteInstallAndRestart(cfg);
    console.log("✓ ship ok");
    console.log(
      `OAuth login: https://${String(cfg.host).replace(/\./g, "-")}.sslip.io/oauth/login`
    );
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
