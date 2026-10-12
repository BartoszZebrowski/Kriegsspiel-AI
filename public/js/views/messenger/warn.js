// Ostrzeżenia pod polem komponowania (nieblokujące): inna własna jednostka w treści rozkazu, pominięcie szczebla
// dowodzenia (T45), nazwa spoza gazetera. Czysty HTML ze stanu; kliknięcia obsługuje widok komunikatora.
import { escapeHtml as e } from '../../domain/markdown.js';
import { foreignUnitMentions, unknownPlaceNames } from '../../domain/compose.js';
import { assessSkip } from '../../domain/command.js';
import { ic } from '../../lib/icons.js';

export function warnHtml(s) {
  const text = s.draft.text;
  const units = s.turn?.units ?? [];
  const parts = [];
  if (s.channel?.kind === 'subordinate' && !s.archive) {
    const others = foreignUnitMentions(text, s.channelUnit, units);
    if (others.length) {
      parts.push(`<div class="warn warn--unit">${ic('zap', 's')}<span>Treść wymienia ${others.map((u) => `„${e(u.name)}”`).join(', ')}, a adresatem jest ${e(s.channel.name)}. Czy to właściwy adresat?</span></div>`);
    }
  }
  if (s.channel && !s.archive) {
    // T45: pominięcie szczebla dowodzenia (nieblokujące w „soft”; w „hard” wysyłka zablokowana poza pilnymi).
    const skip = assessSkip({ scenario: s.scenario, units, channels: s.channels, channelId: s.channel.id, priority: s.draft.urgent ? 'urgent' : 'normal' });
    if (skip.level !== 'none') {
      const tail = skip.level === 'block' ? 'Wysyłka zablokowana — użyj kanału bezpośredniego podwładnego albo oznacz jako pilne.' : 'Pominięty dowódca dowie się z opóźnieniem, a plany mogą się rozjechać.';
      parts.push(`<div class="warn warn--unit warn--skip">${ic('zap', 's')}<span>${e(skip.text.charAt(0).toUpperCase() + skip.text.slice(1))}. ${tail}</span></div>`);
    }
    const ctx = { places: s.places, units, contacts: s.turn?.contacts ?? [], assets: s.turn?.assets ?? [] };
    for (const p of unknownPlaceNames(text, ctx)) {
      parts.push(`<div class="warn warn--place">${ic('pin', 's')}<span>„${e(p.text)}” nie ma w gazeterze.</span><button type="button" class="sw" data-pin="${e(p.text)}">Wskaż na mapie</button></div>`);
    }
  }
  return parts.join('');
}
