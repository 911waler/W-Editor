import type { ObjectDirective } from 'vue'

// A stack keeps keyboard focus inside the innermost reference dialog.
const dialogs: HTMLElement[] = []
const cleanup = new WeakMap<HTMLElement, () => void>()
export const referenceDialogFocus: ObjectDirective<HTMLElement> = {
  mounted(element) {
    const previous = element.ownerDocument.activeElement
    const focusable = () => [...element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')]
    const focusFirst = () => (focusable()[0] ?? element).focus()
    element.tabIndex = -1
    dialogs.push(element)
    const keydown = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== element || event.key !== 'Tab') return
      const controls = focusable()
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) { event.preventDefault(); element.focus(); return }
      if (event.shiftKey && (element.ownerDocument.activeElement === first || element.ownerDocument.activeElement === element)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && element.ownerDocument.activeElement === last) { event.preventDefault(); first.focus() }
    }
    const focusin = (event: FocusEvent) => {
      if (dialogs.at(-1) === element && event.target instanceof Node && !element.contains(event.target)) focusFirst()
    }
    element.addEventListener('keydown', keydown)
    element.ownerDocument.addEventListener('focusin', focusin)
    focusFirst()
    cleanup.set(element, () => {
      dialogs.splice(dialogs.indexOf(element), 1)
      element.removeEventListener('keydown', keydown)
      element.ownerDocument.removeEventListener('focusin', focusin)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    })
  },
  unmounted(element) { cleanup.get(element)?.(); cleanup.delete(element) },
}
