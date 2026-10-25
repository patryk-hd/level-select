import { escapeHtml as esc } from '../lib.js';
import { productInventory, steamProductId } from './products.js';

const labels = { accepted:'Confirmed product', unresolved:'Needs review', changed:'Import details changed — review again', rejected:'Rejected product', 'not-applicable':'Not a Steam PC copy', unavailable:'Copy unavailable' };
const origins = { 'playnite-game-id':'Steam app ID from Playnite', 'title-search':'Title-search candidate', 'csv-steam-id':'App ID supplied in CSV', 'csv-steam-url':'Steam link supplied in CSV', 'legacy-unknown':'Older import — origin unknown', missing:'No imported Steam ID', 'invalid-csv-steam-id':'Invalid CSV app ID', 'invalid-csv-steam-url':'Invalid CSV Steam link' };

export function openProductReview(client, copyId = null) {
  const opener = document.activeElement, dialog = document.createElement('dialog');
  dialog.className = 'tracking-dialog product-review-dialog'; dialog.setAttribute('aria-label','Review Steam products');
  dialog.innerHTML = `<header><h2>Review Steam products</h2><button type="button" data-close>Close</button></header>
    <p>Match your copy to the correct Steam product. Check the edition, release year and whether it is a full game, demo, DLC or bundle.</p>
    <p data-inventory ${copyId?'hidden':''}></p><div class="scope-picker" ${copyId?'hidden':''}><label>Find a copy<input type="search" data-search placeholder="Title, store or year"></label><label>Show<select data-filter><option value="pending">Needs review</option><option value="accepted">Confirmed</option><option value="rejected">Rejected</option><option value="all">All imported copies</option></select></label></div>
    <div data-product-body></div><p role="status" data-product-status></p>
    <details><summary>Backup and refresh</summary>${client.namespace==='sample'?'<p>Sample matches are demonstrations. Refresh accepts personal-workspace backups only.</p>':''}<p>Product decisions are included in Backup &amp; import → Export tracking backup. To fetch scores for confirmed products, export that backup and run:</p><pre>npm run ratings:refresh -- --owned --tracking /path/to/tracking-backup.json --provider steam</pre><p>Unconfirmed and changed copies are skipped. This reads your local backup; only product IDs are sent to Steam. Reload after refreshing.</p></details>`;
  document.body.append(dialog);
  const body = dialog.querySelector('[data-product-body]'), status = dialog.querySelector('[data-product-status]');
  let position = 0;
  function render() {
    const state = client.snapshot(), inventory = productInventory(client.library,state.productReviews);
    const q = dialog.querySelector('[data-search]').value.trim().toLowerCase(), filter = dialog.querySelector('[data-filter]').value;
    const items = inventory.items.filter(item => copyId ? item.copyId === copyId :
      (filter === 'all' || filter === 'pending' && ['unresolved','changed'].includes(item.status) || item.status === filter) &&
      `${item.title} ${item.year ?? ''} ${item.sources.join(' ')}`.toLowerCase().includes(q));
    dialog.querySelector('[data-inventory]').textContent = `${inventory.counts.accepted} confirmed · ${inventory.counts.unresolved + inventory.counts.changed} need review · ${inventory.counts.rejected} rejected · ${inventory.counts['not-applicable']} not applicable${inventory.missingReviewedCopies.length?` · ${inventory.missingReviewedCopies.length} reviewed copies missing from this import`:''}`;
    position = Math.max(0,Math.min(position,items.length-1));
    const item = items[position];
    if (!item) { body.innerHTML='<p>No copies in this selection. Your saved decisions are retained.</p>'; return; }
    const editable = item.applicable && item.status !== 'unavailable';
    body.innerHTML = `<section class="match-candidate"><h3>${esc(item.title)}</h3>
      <p>${esc(item.platforms.join(', ') || 'Unknown platform')} · ${esc(item.sources.join(', ') || 'Unknown store')} · ${esc(item.year ?? 'Unknown year')}</p>
      <p>${esc(origins[item.origin] ?? item.origin)}${item.candidateId?` · imported app ${esc(item.candidateId)}`:''}<br><strong>${esc(labels[item.status])}</strong></p>
      ${editable?`<label>Steam app ID or store URL<input type="text" data-product-input value="${esc(item.productId ?? '')}" autocomplete="off" spellcheck="false"></label>
      <p><a data-product-link target="_blank" rel="noopener noreferrer">Open Steam product ↗</a></p>
      <label class="product-confirm"><input type="checkbox" data-product-confirm> I checked that this is the same product and edition as this library copy.</label>
      <div class="tracking-actions"><button type="button" data-product-decision="accepted">Confirm product</button><button type="button" data-product-decision="rejected">Reject product</button><button type="button" data-product-decision="unresolved">Reset review</button></div>`:'<p>Steam review scores require an imported PC copy from Steam. Other stores and console releases keep their own evidence.</p>'}
      </section>${copyId?'':`<div class="tracking-actions"><button type="button" data-previous ${position===0?'disabled':''}>← Previous</button><span>${position+1} of ${items.length}</span><button type="button" data-next ${position===items.length-1?'disabled':''}>Next →</button></div>`}`;
    body.querySelector('[data-previous]')?.addEventListener('click',()=>{position--;render();});
    body.querySelector('[data-next]')?.addEventListener('click',()=>{position++;render();});
    if (!editable) return;
    const input = body.querySelector('[data-product-input]'), confirm = body.querySelector('[data-product-confirm]'), link = body.querySelector('[data-product-link]');
    const updateLink = () => {
      const id = steamProductId(input.value); link.hidden = !id;
      if(id)link.href=`https://store.steampowered.com/app/${id}/`;else link.removeAttribute('href');
      body.querySelector('[data-product-decision=accepted]').disabled = !id || !confirm.checked;
      body.querySelector('[data-product-decision=rejected]').disabled = !id;
    };
    input.addEventListener('input',()=>{confirm.checked=false;updateLink();});confirm.addEventListener('change',updateLink);updateLink();
    body.querySelectorAll('[data-product-decision]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try {
        const result=await client.reviewProduct({copyId:item.copyId,product:input.value,decision:button.dataset.productDecision,confirmed:confirm.checked,
          expected:state.productReviews[item.copyId]??null,expectedIdentity:item.fingerprint});
        render();status.textContent=result.saved?'Product decision saved. Included in your tracking backup.':'Session only — export your tracking backup before leaving.';
        body.querySelector('input,button')?.focus();
      } catch(error) { status.textContent=error.message;button.disabled=false; }
    }));
  }
  for (const selector of ['[data-search]','[data-filter]']) dialog.querySelector(selector).addEventListener(selector==='[data-search]'?'input':'change',()=>{position=0;render();});
  const unsubscribe=client.subscribe(change=>{if(change.type==='refresh')status.textContent='Tracking changed in another tab. Close and reopen this review to load the latest decisions; your draft is kept.';});
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{unsubscribe();dialog.remove();if(opener?.isConnected)opener.focus();},{once:true});
  render();dialog.showModal();
}
