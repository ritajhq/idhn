import { join, relative } from '@std/path'

export { relative }

/** Every file under `dir`, recursively, in a stable order, skipping `.git`. */
export async function walk(dir: string): Promise<string[]> {
  const files: string[] = []
  const pending = [dir]
  while (pending.length > 0) {
    const current = pending.pop()!
    for await (const entry of Deno.readDir(current)) {
      if (entry.name === '.git') continue
      const path = join(current, entry.name)
      if (entry.isDirectory) pending.push(path)
      else if (entry.isFile) files.push(path)
    }
  }
  return files.sort()
}
