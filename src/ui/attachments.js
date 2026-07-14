// ============ Allegati: blocco UI condiviso (lista + aggiungi/apri/elimina) ============
// Usato sia per i "Documenti" del dipendente (employee.attachments[]) sia per i certificati
// sulle presenze (attendance.attachments[]). I binari passano da store.js via authFetch;
// qui si gestiscono solo i metadati sull'oggetto ospite e la UI.
import { addAttachment, readAttachment, deleteAttachment } from '../state/store.js';
import { esc } from '../domain/util.js';
import { confirmDialog, toast } from './dom.js';

const fmtSize = b => { b = b || 0; return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; };

// HTML della lista allegati + (se canEdit) pulsante di aggiunta. `idPrefix` isola gli id
// quando ci sono più blocchi nella stessa vista/scheda.
export function attachmentsHTML(atts, { canEdit = false, idPrefix = 'att', empty = 'Nessun allegato.' } = {}) {
  atts = atts || [];
  let h = '';
  if (atts.length) {
    h += `<div class="list">${atts.map(a => `<div class="row">
      <div class="emoji">📎</div>
      <div class="mid" data-att-open="${esc(a.id)}" style="cursor:pointer;min-width:0"><div class="t1">${esc(a.name)}</div><div class="t2">${fmtSize(a.size)}${a.addedAt ? ' · ' + new Date(a.addedAt).toLocaleDateString('it-IT') : ''}</div></div>
      ${canEdit ? `<button class="btn sm danger" data-att-del="${esc(a.id)}">Elimina</button>` : ''}
    </div>`).join('')}</div>`;
  } else {
    h += `<div class="card empty" style="padding:14px">${esc(empty)}</div>`;
  }
  if (canEdit) h += `<div class="btnrow" style="margin-top:10px"><button class="btn sm" data-att-add>+ Aggiungi allegato</button><input type="file" id="${esc(idPrefix)}_input" style="display:none"></div>`;
  return h;
}

// Collega gli eventi degli allegati dentro `scope`. getAtts()/setAtts(arr) leggono/scrivono
// l'array di metadati sull'oggetto ospite; onChange() persiste e aggiorna la UI.
export function bindAttachments(scope, { getAtts, setAtts, canEdit = false, idPrefix = 'att', onChange } = {}) {
  const input = scope.querySelector('#' + idPrefix + '_input');
  if (canEdit && input) {
    scope.querySelector('[data-att-add]')?.addEventListener('click', () => input.click());
    input.onchange = async () => {
      const f = input.files[0]; input.value = '';
      if (!f) return;
      toast('Caricamento…');
      const r = await addAttachment(f);
      if (!r.ok) { toast('Caricamento allegato non riuscito'); return; }
      setAtts((getAtts() || []).concat(r.meta));
      onChange?.(); toast('Allegato aggiunto ✓');
    };
  }
  scope.querySelectorAll('[data-att-open]').forEach(el => el.onclick = async () => {
    const a = (getAtts() || []).find(x => String(x.id) === el.dataset.attOpen);
    if (!a) return;
    const file = await readAttachment(a);
    if (!file) { toast('Allegato non trovato'); return; }
    const url = URL.createObjectURL(file);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  if (canEdit) scope.querySelectorAll('[data-att-del]').forEach(b => b.onclick = () => {
    const a = (getAtts() || []).find(x => String(x.id) === b.dataset.attDel);
    if (!a) return;
    confirmDialog('Eliminare l\'allegato?', a.name, 'Elimina', async () => {
      await deleteAttachment(a);
      setAtts((getAtts() || []).filter(x => String(x.id) !== String(a.id)));
      onChange?.(); toast('Allegato eliminato');
    }, { danger: true });
  });
}
