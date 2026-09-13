const NAME = "karaoke.displayName";
const ID = "karaoke.clientId";
const COLOR = "karaoke.avatarColor";

const COLORS = ["#e8c36a", "#c4312e", "#7eb8c9", "#d9783a", "#b86b9a", "#6dbf8b"];

export function getClientId(): string {
  let id = localStorage.getItem(ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID, id);
  }
  return id;
}

export function getDisplayName(): string {
  return localStorage.getItem(NAME) ?? "";
}

export function setDisplayName(name: string): string {
  const trimmed = name.trim().slice(0, 16);
  localStorage.setItem(NAME, trimmed);
  getClientId();
  if (!localStorage.getItem(COLOR)) {
    localStorage.setItem(COLOR, COLORS[Math.floor(Math.random() * COLORS.length)]);
  }
  return trimmed;
}

export function getAvatarColor(): string {
  return localStorage.getItem(COLOR) || COLORS[0];
}

export function validName(name: string): boolean {
  const n = name.trim().length;
  return n >= 2 && n <= 16;
}

/** Persist the name locally and tell Atlas. Socket hello is the caller's job. */
export async function commitDisplayName(name: string): Promise<string> {
  const saved = setDisplayName(name);
  try {
    await fetch("/api/player/hello", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: getClientId(), displayName: saved }),
    });
  } catch {
    /* still continue */
  }
  return saved;
}
