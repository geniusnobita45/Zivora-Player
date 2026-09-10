import { spawn } from "node:child_process";

export interface CommandSpec {
  command: string;
  args: readonly string[];
  cwd?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProcessRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

export class CommandExecutionError extends Error {
  constructor(
    readonly spec: CommandSpec,
    readonly result: CommandResult,
  ) {
    super(`${spec.command} exited with code ${result.exitCode}: ${result.stderr.trim()}`);
    this.name = "CommandExecutionError";
  }
}

export class NodeProcessRunner implements ProcessRunner {
  run(spec: CommandSpec): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(spec.command, [...spec.args], {
        cwd: spec.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (exitCode) => {
        const result = { stdout, stderr, exitCode: exitCode ?? -1 };
        if (result.exitCode === 0) resolve(result);
        else reject(new CommandExecutionError(spec, result));
      });
    });
  }
}
