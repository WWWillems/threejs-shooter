import {
  GAME_EVENTS,
  type ChatMessageEvent,
} from "@threejs-shooter/shared";
import type { IsometricControls } from "./IsometricControls";
import type { NetworkClient } from "../net/NetworkClient";

const CHAT_MAX_LENGTH = 128;
const MAX_VISIBLE_MESSAGES = 8;
const MESSAGE_LIFETIME_MS = 10_000;
const MESSAGE_FADE_MS = 500;

interface MessageTimers {
  fade: number;
  remove: number;
}

/**
 * Room-wide text chat. The server echo is the acknowledgement that clears a
 * submitted draft while leaving the input open, so rejected messages remain
 * available for retry.
 */
export class Chat {
  private readonly root: HTMLElement;
  private readonly messagesElement: HTMLElement;
  private readonly inputPanel: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly messageTimers = new Map<HTMLElement, MessageTimers>();
  private readonly pendingMessages = new Set<string>();
  private isOpen = false;

  constructor(
    overlay: HTMLElement,
    private readonly controls: IsometricControls,
    private readonly net: NetworkClient,
  ) {
    this.root = document.createElement("section");
    this.root.className = "chat-widget";
    this.root.setAttribute("aria-label", "Game chat");

    this.messagesElement = document.createElement("div");
    this.messagesElement.className = "chat-messages";
    this.messagesElement.setAttribute("aria-live", "polite");
    this.root.append(this.messagesElement);

    this.inputPanel = document.createElement("div");
    this.inputPanel.className = "chat-input-panel";
    this.inputPanel.hidden = true;

    const prompt = document.createElement("span");
    prompt.className = "chat-input-prompt";
    prompt.textContent = "CHAT";
    this.inputPanel.append(prompt);

    this.input = document.createElement("input");
    this.input.className = "chat-input";
    this.input.type = "text";
    this.input.maxLength = CHAT_MAX_LENGTH;
    this.input.placeholder = "Type a message...";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "Chat message");
    this.inputPanel.append(this.input);
    this.root.append(this.inputPanel);
    overlay.append(this.root);

    this.root.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
    this.input.addEventListener("keydown", this.handleInputKeyDown);
    document.addEventListener("keydown", this.handleDocumentKeyDown);
    this.net.on(GAME_EVENTS.CHAT.MESSAGE, (message) => {
      this.handleMessage(message);
    });
  }

  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (this.isOpen && event.code === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }

    if (
      this.isOpen ||
      !this.controls.isEnabled() ||
      this.controls.getHealth().isDead ||
      event.code !== "KeyY"
    ) {
      return;
    }

    event.preventDefault();
    this.open();
  };

  private readonly handleInputKeyDown = (event: KeyboardEvent): void => {
    // Do not let movement, weapon, or debug handlers see text input events.
    event.stopPropagation();

    if (event.code === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.code !== "Enter") return;
    event.preventDefault();

    const text = this.input.value.trim();
    if (!text) {
      return;
    }

    this.pendingMessages.add(text);
    this.net.send(GAME_EVENTS.CHAT.MESSAGE, { text });
  };

  private open(): void {
    this.isOpen = true;
    this.pendingMessages.clear();
    this.input.value = "";
    this.inputPanel.hidden = false;
    this.root.classList.add("is-open");
    this.controls.disableControls();
    this.input.focus();
  }

  private close(): void {
    this.isOpen = false;
    this.pendingMessages.clear();
    this.input.value = "";
    this.input.blur();
    this.inputPanel.hidden = true;
    this.root.classList.remove("is-open");

    if (!this.controls.getHealth().isDead) {
      this.controls.enableControls();
    }
  }

  private handleMessage(message: ChatMessageEvent): void {
    this.renderMessage(message);

    if (
      message.senderId === this.net.selfId &&
      this.pendingMessages.delete(message.text) &&
      this.input.value.trim() === message.text
    ) {
      this.input.value = "";
    }
  }

  private renderMessage(message: ChatMessageEvent): void {
    const element = document.createElement("div");
    element.className =
      message.senderId === this.net.selfId
        ? "chat-message is-self"
        : "chat-message";

    const sender = document.createElement("span");
    sender.className = "chat-message-sender";
    sender.textContent = `${message.senderName}:`;
    element.append(sender);

    const text = document.createElement("span");
    text.className = "chat-message-text";
    text.textContent = ` ${message.text}`;
    element.append(text);

    this.messagesElement.append(element);

    while (this.messagesElement.children.length > MAX_VISIBLE_MESSAGES) {
      const oldest = this.messagesElement.firstElementChild;
      if (!oldest) break;
      this.removeMessage(oldest as HTMLElement);
    }

    const fade = window.setTimeout(() => {
      element.classList.add("is-fading");
    }, MESSAGE_LIFETIME_MS - MESSAGE_FADE_MS);
    const remove = window.setTimeout(() => {
      this.removeMessage(element);
    }, MESSAGE_LIFETIME_MS);
    this.messageTimers.set(element, { fade, remove });
  }

  private removeMessage(element: HTMLElement): void {
    const timers = this.messageTimers.get(element);
    if (timers) {
      window.clearTimeout(timers.fade);
      window.clearTimeout(timers.remove);
      this.messageTimers.delete(element);
    }
    element.remove();
  }
}
