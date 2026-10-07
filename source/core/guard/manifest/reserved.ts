/**
 * Action names idhn keeps for the actions every guard answers itself, such
 * as reading its manifest. A manifest may not declare an action under it, so
 * no service action can pass for one of these.
 */
export const RESERVED_NAMESPACE = 'idhn'

/** Reading the guard's manifest, as `<manifest id>.idhn.manifest.read`. */
export const READ_MANIFEST = `${RESERVED_NAMESPACE}.manifest.read`

export function isReserved(actionName: string): boolean {
  return actionName === RESERVED_NAMESPACE ||
    actionName.startsWith(`${RESERVED_NAMESPACE}.`)
}
