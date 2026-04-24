export const PROMPT_PLACEHOLDER = '{prompt}'

export function resolveCommandArgs(args: string[], prompt: string): string[] {
  if (args.some((arg) => arg.includes(PROMPT_PLACEHOLDER))) {
    return args.map((arg) => arg.replaceAll(PROMPT_PLACEHOLDER, prompt))
  }

  return [...args, prompt]
}
