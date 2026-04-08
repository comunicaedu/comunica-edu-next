const { execSync, spawn } = require("child_process");

// Mata qualquer processo rodando na porta 3000 antes de iniciar
try {
  execSync(
    'for /f "tokens=5" %a in (\'netstat -aon ^| find ":3000" ^| find "LISTENING"\') do taskkill /F /PID %a',
    { shell: "cmd", stdio: "ignore" }
  );
} catch {}

// Inicia o servidor com memória ampliada
const child = spawn(
  "node",
  ["--max-old-space-size=4096", "node_modules/next/dist/bin/next", "dev", "--turbopack"],
  { stdio: "inherit", shell: false }
);

child.on("exit", (code) => process.exit(code ?? 0));
