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

async function loadState(): Promise<SharedHistoryState> {
  const raw = await chrome.storage.local.get(SHARED_HISTORY_STORAGE_KEY);
  return normalizeSharedHistoryState(raw[SHARED_HISTORY_STORAGE_KEY]);
}

async function saveState(value: unknown): Promise<SharedHistoryState> {
  const state = normalizeSharedHistoryState(value);
  await chrome.storage.local.set({ [SHARED_HISTORY_STORAGE_KEY]: state });
  return state;
}

function postToPage(message: BridgeMessage) {
  window.postMessage(message, window.location.origin);
}

window.addEventListener("message", (event) => {
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
    void saveState(data.payload);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
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
});
