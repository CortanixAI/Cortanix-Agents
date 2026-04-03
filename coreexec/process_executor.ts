import { exec } from "child_process"

/**
 * Execute a shell command and return stdout.
 * Includes timeout, stderr capture, and exit code handling.
 */
export function execCommand(
  command: string,
  timeoutMs: number = 30_000,
  cwd?: string,
  env?: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = exec(
      command,
      { timeout: timeoutMs, cwd, env },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode = (error as any).code
          return reject(
            new Error(
              `Command failed (exit ${exitCode ?? "unknown"}): ${stderr || error.message}`
            )
          )
        }
        if (stderr && stderr.trim().length > 0) {
          // sometimes tools write warnings to stderr but still succeed
          console.warn(`Command stderr: ${stderr.trim()}`)
        }
        resolve(stdout.trim())
      }
    )

    // catch edge cases where process is killed by timeout
    proc.on("error", (err) => {
      reject(new Error(`Process error: ${err.message}`))
    })
  })
}
