import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;

/** Right click on desktop, long press on touch: both open the same list of actions. */
export function useContextMenu(items: () => readonly MenuItem[]) {
  const [open, setOpen] = useState<{ x: number; y: number; items: readonly MenuItem[] } | null>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);

  const show = (x: number, y: number) => {
    const list = items();
    if (list.length > 0) setOpen({ x, y, items: list });
  };
  const cancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const handlers = {
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      show(event.clientX, event.clientY);
    },
    onPointerDown: (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      const { clientX: x, clientY: y } = event;
      cancel();
      press.current = { x, y, timer: window.setTimeout(() => show(x, y), LONG_PRESS_MS) };
    },
    onPointerMove: (event: PointerEvent) => {
      const start = press.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };

  const close = useCallback(() => setOpen(null), []);
  const menu = open ? <ContextMenu x={open.x} y={open.y} items={open.items} onClose={close} /> : null;
  return { handlers, menu };
}

function ContextMenu(props: { x: number; y: number; items: readonly MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: props.x, top: props.y });

  useEffect(() => {
    const node = ref.current;
    if (node) {
      const { width, height } = node.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(props.x, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(props.y, window.innerHeight - height - 8)),
      });
      node.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
    const outside = (event: globalThis.PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) props.onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", props.onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", props.onClose);
    };
  }, [props.x, props.y, props.onClose]);

  return createPortal(
    <div ref={ref} className="context-menu" role="menu" style={position} onContextMenu={(event) => event.preventDefault()}>
      {props.items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? "danger" : undefined}
          disabled={item.disabled}
          onClick={() => {
            props.onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** A list row that opens the action menu on right click or long press. */
export function MenuRow(props: { items: () => readonly MenuItem[]; className?: string; children: ReactNode }) {
  const context = useContextMenu(props.items);
  return (
    <li {...context.handlers} className={props.className}>
      {props.children}
      {context.menu}
    </li>
  );
}
