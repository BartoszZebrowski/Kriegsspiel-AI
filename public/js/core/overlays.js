// Intencje nakładek od przełożonego (T51): kopiowanie do szkiców gracza i dołączanie do rozkazu. Bez DOM; logika w domain/overlays.js.
import { overlayNotes } from '../domain/overlays.js';

// `saveNotes(items)` — zapis listy szkiców (kontroler); `setDraft(channelId, patch)` — szkic wiadomości kanału.
export function createOverlays({ store, S, notify, saveNotes, setDraft }) {
  // Kopiuje elementy nakładki do szkiców; `attach` dodatkowo dołącza je do szkicu wiadomości aktywnego kanału.
  async function copyOverlayToNotes(id, { attach = false } = {}) {
    const overlay = S().overlays?.find((o) => o.id === id);
    if (!overlay) return false;
    if (S().archive) {
      notify('Archiwum — szkice tylko do podglądu', true);
      return false;
    }
    const r = overlayNotes(overlay, S().notes);
    if (r.error) {
      notify(r.error, true);
      return false;
    }
    const channel = S().channel?.id;
    if (attach && !channel) {
      notify('Wybierz kanał, do którego dołączyć nakładkę', true);
      return false;
    }
    const saved = await saveNotes([...S().notes, ...r.notes]);
    if (!saved) return false;
    if (attach) setDraft(channel, { attachIds: [...new Set([...(S().drafts[channel]?.attachIds ?? []), ...r.notes.map((n) => n.id)])] });
    notify(attach ? `Nakładka „${overlay.name}” skopiowana do szkiców i dołączona do rozkazu` : `Nakładka „${overlay.name}” skopiowana do szkiców`);
    return true;
  }
  return { copyOverlayToNotes };
}
