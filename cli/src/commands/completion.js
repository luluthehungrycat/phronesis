export const command = "completion [shell]";
export const describe = "Generate shell completion script";

export function builder(yargs) {
  return yargs.positional("shell", {
    describe: "Shell type",
    choices: ["bash", "zsh", "fish"],
    default: "bash",
  });
}

export function handler(argv) {
  switch (argv.shell || "bash") {
    case "bash":
      console.log(bashScript);
      break;
    case "zsh":
      console.log(zshScript);
      break;
    case "fish":
      console.log(fishScript);
      break;
    default:
      console.error("Unknown shell: " + argv.shell + ". Use bash, zsh, or fish.");
      process.exit(1);
  }
}

// ─── Command data (single source of truth) ──────────────────────────────────

const COMMANDS = {
  top: [
    { name: "chat", desc: "Start an interactive session or send a single query" },
    { name: "continue", desc: "Continue the most recent session" },
    { name: "fork", desc: "Fork the most recent session" },
    { name: "version", desc: "Show version information" },
    { name: "config", desc: "Manage Phronesis configuration" },
    { name: "profile", desc: "Manage Phronesis profiles" },
    { name: "gateway", desc: "Manage Telegram gateways" },
    { name: "skills", desc: "Manage Phronesis skills" },
    { name: "sessions", desc: "Browse and search sessions" },
    { name: "setup", desc: "Run the first-time setup wizard" },
    { name: "doctor", desc: "Run system diagnostics" },
    { name: "migrate", desc: "Migrate from other tools" },
    { name: "completion", desc: "Generate shell completion script" },
    { name: "send", desc: "Send a message to a platform" },
    { name: "plugin", desc: "Manage Phronesis plugins" },
    { name: "create-plugin", desc: "Scaffold a new plugin" },
    { name: "upgrade", desc: "Upgrade Phronesis CLI" },
    { name: "dashboard", desc: "Start the web dashboard" },
  ],
  sub: {
    config:    ["get", "set", "path", "edit"],
    profile:   ["list", "current", "use", "create", "delete", "path"],
    gateway:   ["status", "start", "stop", "restart", "logs", "install", "uninstall"],
    skills:    ["list", "install", "update", "feedback"],
    sessions:  ["list", "search", "rebuild"],
    migrate:   ["claw", "hermes"],
    completion: ["bash", "zsh", "fish"],
    upgrade:   ["github", "npm"],
    plugin:    ["search", "info", "list", "install"],
  },
};

const bashScript = [
  "# phronesis bash completion",
  "# Source this file:  source <(phronesis completion bash)",
  "# Or install:       phronesis completion bash > ~/.local/share/bash-completion/completions/phronesis",
  "",
  "_phronesis_completions() {",
  '  local cur="${\"COMP_WORDS[COMP_CWORD]\"}"',
  '  local prev="${\"COMP_WORDS[COMP_CWORD-1]\"}"',
  "",
  "  # Complete flags",
  '  if [[ "$cur" == -* ]]; then',
  '    COMPREPLY=($(compgen -W "--profile -p --port --url --help -h -v --version" -- "$cur"))',
  "    return",
  "  fi",
  "",
  '  if [[ "$COMP_CWORD" -eq 1 ]]; then',
  '    COMPREPLY=($(compgen -W "chat continue fork version config profile gateway skills sessions setup doctor migrate completion send plugin create-plugin upgrade dashboard" -- "$cur"))',
  "    return",
  "  fi",
  "",
  '  case "$prev" in',
  '    config)       COMPREPLY=($(compgen -W "get set path edit" -- "$cur")) ;;',
  '    profile)      COMPREPLY=($(compgen -W "list current use create delete path" -- "$cur")) ;;',
  '    gateway)      COMPREPLY=($(compgen -W "status start stop restart logs install uninstall" -- "$cur")) ;;',
  '    skills)       COMPREPLY=($(compgen -W "list install update feedback" -- "$cur")) ;;',
  '    sessions)     COMPREPLY=($(compgen -W "list search rebuild" -- "$cur")) ;;',
  '    migrate)      COMPREPLY=($(compgen -W "claw hermes" -- "$cur")) ;;',
  '    completion)   COMPREPLY=($(compgen -W "bash zsh fish" -- "$cur")) ;;',
  '    upgrade)      COMPREPLY=($(compgen -W "github npm" -- "$cur")) ;;',
  '    plugin)       COMPREPLY=($(compgen -W "search info list install" -- "$cur")) ;;',
  "  esac",
  "}",
  "",
  "complete -F _phronesis_completions phronesis",
].join("\n");

const zshScript = [
  "# phronesis zsh completion",
  "# Source this file:  source <(phronesis completion zsh)",
  "# Or install:       phronesis completion zsh > ~/.zsh-completions/_phronesis",
  "",
  "#compdef phronesis",
  "",
  "_phronesis_commands() {",
  "  local -a commands",
  "  commands=(",
  ...COMMANDS.top.map(({ name, desc }) => `    '${name}:${desc}'`),
  "  )",
  "  _describe 'command' commands",
  "}",
  "",
  "_phronesis_subcommands() {",
  "  local -A subs",
  '  subs=(',
  ...Object.entries(COMMANDS.sub).map(([cmd, actions]) =>
    `    "${cmd}" "${actions.join(' ')}"`),
  "  )",
  '  local actions="${subs[$words[1]]}"',
  '  if [[ -n "$actions" ]]; then',
  "    _arguments \"2:action:($actions)\"",
  "  fi",
  "}",
  "",
  "_phronesis() {",
  "  local context state state_descr line",
  "  typeset -A opt_args",
  "",
  "  _arguments \\",
  "    '(-p --profile)'{-p,--profile}'[Use a specific profile]:profile:()' \\",
  "    '--port[OpenCode server port]:port:' \\",
  "    '--url[OpenCode server URL]:url:' \\",
  "    '(-h --help)'{-h,--help}'[Show help]' \\",
  "    '1: :->command' \\",
  "    '*:: :->args'",
  "",
  '  case "$state" in',
  "    command)",
  "      _phronesis_commands",
  "      ;;",
  "    args)",
  "      _phronesis_subcommands",
  "      ;;",
  "  esac",
  "}",
  "",
  "compdef _phronesis phronesis",
].join("\n");

const fishScript = [
  "# phronesis fish completion",
  "# Source this file:  phronesis completion fish | source",
  "# Or install:       phronesis completion fish > ~/.config/fish/completions/phronesis.fish",
  "",
  "complete -c phronesis -f",
  // Top-level commands
  ...COMMANDS.top.map(({ name, desc }) =>
    `complete -c phronesis -n "test (count __fish_argv) -le 1" -a ${name} -d "${desc}"`),
  "",
  "# Subcommands",
  ...Object.entries(COMMANDS.sub).map(([cmd, actions]) =>
    `complete -c phronesis -n "__fish_phronesis_using_command ${cmd}" -a "${actions.join(' ')}" -f`),
  "",
  "# Flags",
  'complete -c phronesis -s p -l profile -d "Use a specific profile" -r',
  'complete -c phronesis -l port -d "OpenCode server port" -r',
  'complete -c phronesis -l url -d "OpenCode server URL" -r',
  'complete -c phronesis -s h -l help -d "Show help"',
].join("\n");
