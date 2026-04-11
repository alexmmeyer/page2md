import {
  SHARED_HISTORY_STORAGE_KEY,
  type SharedHistoryState,
  normalizeSharedHistoryState,
} from "@/lib/history/shared-history";

const BRIDGE_SOURCE_WEB = "page2md-web";
const BRIDGE_SOURCE_EXTENSION = "page2md-extension";
const BRIDGE_CHANNEL = "page2md-history-bridge";
const MSG_GET_HISTORY = "PAGE2MD_GET_HISTORY";
const MSG_SET_HISTORY = "PAGE2MD_SET_HISTORY";
const MSG_HISTORY_RESPONSE = "PAGE2MD_HISTORY_RESPONSE";
const MSG_HISTORY_CHANGED = "PAGE2MD_HISTORY_CHANGED";

interface BridgeMessage {
  source: string;
  channel: string;
  type: string;
  requestId?: string;
  payload?: unknown;
}

function isContextInvalidatedError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  return /extension context invalidated/i.test(message);
}

function hasValidStateShape(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Array.isArray((value as { items?: unknown }).items);
}

function emptyState(): SharedHistoryState {
  return { items: [], activeId: null, revision: 0 };
}

function isExtensionContextAlive(): boolean {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

let bridgeDisabled = false;

function disableBridge() {
  if (bridgeDisabled) {
    return;
  }
  bridgeDisabled = true;
  window.removeEventListener("message", onBridgeMessage);
  try {
    chrome.storage.onChanged.removeListener(onStorageChanged);
  } catch {
    // Ignore listener cleanup failures while tearing down.
  }
}

async function loadState(): Promise<SharedHistoryState> {
  if (bridgeDisabled || !isExtensionContextAlive()) {
    disableBridge();
    return emptyState();
  }
  try {
    const raw = await chrome.storage.local.get(SHARED_HISTORY_STORAGE_KEY);
    return normalizeSharedHistoryState(raw[SHARED_HISTORY_STORAGE_KEY]);
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      disableBridge();
      return emptyState();
    }
    console.warn("page2md history bridge failed to load state", error);
    return emptyState();
  }
}

async function saveState(value: unknown): Promise<SharedHistoryState> {
  const state = normalizeSharedHistoryState(value);
  if (bridgeDisabled || !isExtensionContextAlive()) {
    disableBridge();
    return state;
  }
  try {
    await chrome.storage.local.set({ [SHARED_HISTORY_STORAGE_KEY]: state });
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      disableBridge();
      return state;
    }
    console.warn("page2md history bridge failed to save state", error);
  }
  return state;
}

function postToPage(message: BridgeMessage) {
  if (bridgeDisabled) {
    return;
  }
  try {
    window.postMessage(message, window.location.origin);
  } catch {
    // Ignore posting failures during teardown/navigation.
  }
}

function onBridgeMessage(event: MessageEvent) {
  if (bridgeDisabled || !isExtensionContextAlive()) {
    disableBridge();
    return;
  }
  if (event.source !== window || event.origin !== window.location.origin) {
    return;
  }

  const data = event.data as BridgeMessage | undefined;
  if (!data || data.source !== BRIDGE_SOURCE_WEB || data.channel !== BRIDGE_CHANNEL) {
    return;
  }

  if (data.type === MSG_GET_HISTORY) {
    void (async () => {
      const state = await loadState();
      postToPage({
        source: BRIDGE_SOURCE_EXTENSION,
        channel: BRIDGE_CHANNEL,
        type: MSG_HISTORY_RESPONSE,
        requestId: data.requestId,
        payload: state,
      });
    })();
    return;
  }

  if (data.type === MSG_SET_HISTORY) {
    if (!hasValidStateShape(data.payload)) {
      console.warn("page2md history bridge rejected invalid state payload");
      return;
    }
    void (async () => {
      await saveState(data.payload);
    })();
  }
}

window.addEventListener("message", onBridgeMessage);

function onStorageChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) {
  if (bridgeDisabled || !isExtensionContextAlive()) {
    disableBridge();
    return;
  }
  try {
    if (areaName !== "local" || !changes[SHARED_HISTORY_STORAGE_KEY]) {
      return;
    }

    const state = normalizeSharedHistoryState(changes[SHARED_HISTORY_STORAGE_KEY].newValue);
    postToPage({
      source: BRIDGE_SOURCE_EXTENSION,
      channel: BRIDGE_CHANNEL,
      type: MSG_HISTORY_CHANGED,
      payload: state,
    });
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      disableBridge();
      return;
    }
    console.warn("page2md history bridge failed during storage change", error);
  }
}

try {
  if (!isExtensionContextAlive()) {
    disableBridge();
  } else {
    chrome.storage.onChanged.addListener(onStorageChanged);
  }
} catch (error) {
  if (isContextInvalidatedError(error)) {
    disableBridge();
  } else {
    console.warn("page2md history bridge failed to register storage listener", error);
  }
}
