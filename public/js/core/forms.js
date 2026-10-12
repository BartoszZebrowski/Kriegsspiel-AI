// Podkontroler formularzy (T50): wybór szablonu, wartości pól i wskazywanie geometrii na mapie.
// Formularz leży w szkicu kanału (store.drafts[kanał].form). Wskazywanie współdzieli mechanizm T48
// (store.ccirEditor.pick z target "form"): widok mapy zgłasza wynik do formSetGeometry.
import { emptyForm, setFormField, formDef } from '../domain/forms.js';
import { getDraft } from '../domain/compose.js';

export function createForms({ store, S, setDraft }) {
  const draftOf = (channelId) => getDraft(S().drafts, channelId);
  const setPick = (pick) => store.set({ ccirEditor: { ...S().ccirEditor, pick } });

  // Wybór szablonu w kanale; nowy rodzaj wiadomości zgodny z szablonem (FRAGO → rozkaz, SPOTREP → meldunek).
  function formSelect(channelId, kind) {
    const def = formDef(kind);
    if (!channelId || !def) return;
    setDraft(channelId, { form: emptyForm(kind), type: def.type });
  }
  function formSetField(channelId, id, value) {
    const form = draftOf(channelId).form;
    if (form) setDraft(channelId, { form: setFormField(form, id, value) });
  }
  function formClear(channelId) {
    if (S().ccirEditor.pick?.target === 'form') setPick(null);
    setDraft(channelId, { form: null });
  }

  // Wskazywanie pola „gdzie”/„cel”: punkt, linia albo rejon (jak CCIR). Powtórne wywołanie z tym samym polem anuluje.
  function formPickStart(channelId, fieldId, shape) {
    const def = formDef(draftOf(channelId).form?.kind);
    const field = def?.fields.find((f) => f.id === fieldId);
    if (!field || field.type !== 'geo' || !field.shapes.includes(shape)) return;
    const cur = S().ccirEditor.pick;
    if (cur?.target === 'form' && cur.id === fieldId && cur.shape === shape) return setPick(null);
    setPick({ id: fieldId, shape, target: 'form', channel: channelId });
  }
  function formSetGeometry(fieldId, geometry) {
    const pick = S().ccirEditor.pick;
    if (pick?.target !== 'form' || pick.id !== fieldId) return;
    setPick(null);
    formSetField(pick.channel, fieldId, geometry);
  }

  return { formSelect, formSetField, formClear, formPickStart, formSetGeometry };
}
