export interface ActionConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
  placement?: "anchored" | "modal";
}

let activeConfirmation: (() => void) | null = null;

export function requestActionConfirmation(
  trigger: HTMLElement | null,
  options: ActionConfirmationOptions
): Promise<boolean> {
  activeConfirmation?.();

  return new Promise((resolve) => {
    const placement = options.placement ?? "anchored";
    const layer = document.createElement("div");
    layer.className = `action-confirmation-layer action-confirmation-layer--${placement}`;
    const panel = document.createElement("section");
    const titleId = `action-confirmation-title-${crypto.randomUUID()}`;
    const messageId = `action-confirmation-message-${crypto.randomUUID()}`;
    panel.className = `action-confirmation action-confirmation--${placement}`;
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-labelledby", titleId);
    panel.setAttribute("aria-describedby", messageId);
    panel.setAttribute("aria-modal", placement === "modal" ? "true" : "false");
    panel.tabIndex = -1;

    const title = document.createElement("h2");
    title.id = titleId;
    title.textContent = options.title;
    const message = document.createElement("p");
    message.id = messageId;
    message.textContent = options.message;

    const actions = document.createElement("div");
    actions.className = "action-confirmation-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = options.cancelLabel ?? "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = options.tone === "destructive" ? "danger-button" : "primary-button";
    confirm.textContent = options.confirmLabel ?? "Continue";
    actions.append(cancel, confirm);
    panel.append(title, message, actions);
    layer.append(panel);
    document.body.append(layer);

    const restoreFocus = (): void => {
      if (trigger?.isConnected && !trigger.hasAttribute("disabled")) trigger.focus();
    };
    const close = (accepted: boolean): void => {
      if (!layer.isConnected) return;
      layer.remove();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (activeConfirmation === cancelConfirmation) activeConfirmation = null;
      restoreFocus();
      resolve(accepted);
    };
    const cancelConfirmation = (): void => close(false);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== "Tab" || placement !== "modal") return;
      const focusable = [cancel, confirm];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (placement === "anchored" && !panel.contains(event.target as Node) && event.target !== trigger) close(false);
    };
    const position = (): void => {
      if (placement !== "anchored") return;
      const rect = trigger?.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const gap = 8;
      const left = Math.max(gap, Math.min(rect?.left ?? gap, window.innerWidth - width - gap));
      const below = (rect?.bottom ?? 0) + gap;
      const top = below + height <= window.innerHeight - gap
        ? below
        : Math.max(gap, (rect?.top ?? height + gap) - height - gap);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };

    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    layer.addEventListener("click", (event) => {
      if (placement === "modal" && event.target === layer) close(false);
    });
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    activeConfirmation = cancelConfirmation;
    position();
    cancel.focus();
  });
}
