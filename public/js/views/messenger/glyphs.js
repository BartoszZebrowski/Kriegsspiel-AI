// Ikony i awatary kanałów komunikatora: symbol NATO jednostki kanału albo ikona roli.
import { escapeHtml as e } from '../../domain/markdown.js';
import { tabLabel } from '../../domain/messages.js';
import { channelUnitId } from '../../domain/orbat.js';
import { symbolSvg } from '../../lib/symbols.js';
import { ic } from '../../lib/icons.js';

const unitSidc = (s, unitId) => (s.turn?.units || []).find((u) => u.id === unitId)?.sidc;
const roleIcon = (c) => (c.kind === 'recon' ? ic('radio', 's') : c.kind === 'logistics' ? ic('truck', 's') : null);

export function channelGlyph(s, c, size) {
  const sidc = unitSidc(s, channelUnitId(c));
  if (sidc && c.kind !== 'recon') return symbolSvg(sidc, { size }).svg;
  return roleIcon(c) || e(tabLabel(c).slice(0, 3));
}
