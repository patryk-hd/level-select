import { escapeHtml as esc } from '../lib.js';
import { CHALLENGE_TEMPLATES, chooseChallengeMember, challengeIdentity, challengeProgress, validChallengeAward, distinctChallengeGames, challengeLists } from '../tracking/challenges.js';

export function setupChallenges(client,openTarget) {
  const host=document.getElementById('playChallenges');
  const templateName=id=>CHALLENGE_TEMPLATES[id].name;
  // "Series sampler · Zelda": a list template's board is named after its list.
  const capital=name=>name.charAt(0).toUpperCase()+name.slice(1);
  const boardName=rules=>rules.list?`${templateName(rules.templateId)} · ${capital(challengeLists(rules.templateId)?.[rules.list]?.name??rules.list)}`:templateName(rules.templateId);
  // Owned Windows copies share the catalog's classic-PC key; in your library they are simply PC.
  const systemName=id=>id==='dos'?'PC':client.catalog.systems.find(system=>system.id===id)?.name??id;
  const byName=(a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'});
  const categoryName=(rules,category)=>rules.templateId==='passport'?systemName(category):rules.templateId==='decades'?`${category}s`:rules.templateId==='bingo'?category:`Game ${category}`;
  const showRewards=()=>client.snapshot().settings.gamificationVisible;
  function dialog(title) {
    const opener=document.activeElement,node=document.createElement('dialog');node.id='challengeEditor';node.className='tracking-dialog challenge-editor';node.setAttribute('aria-labelledby','challengeEditorTitle');
    node.innerHTML=`<header><h2 id="challengeEditorTitle">${esc(title)}</h2><button type="button" data-close>Cancel</button></header>`;
    node.querySelector('[data-close]').onclick=()=>node.close();
    node.addEventListener('close',()=>{node.remove();if(opener?.isConnected)opener.focus();else host.querySelector('button')?.focus();},{once:true});document.body.append(node);return node;
  }
  function memberCopy(member) {
    return `<p class="challenge-meta">${esc(systemName(member.platform))} · ${esc(member.year??'Year unknown')} · ${esc(member.genres.join(', ')||'Genre unknown')}</p><p class="challenge-meta">${esc(member.ownership)}${member.rank?` · List #${member.rank.position} on ${esc(systemName(member.rank.systemId))} (${esc(member.rank.match)})`:''}</p>`;
  }
  function previewEditor({templateId='season',previousId=null,cellId=null}={}) {
    const state=client.snapshot(),previous=previousId&&state.challenges[previousId],old=previous&&state.challengeRevisions[previous.currentRevision];
    let preview=null,sameGame=challengeIdentity(state);
    const node=dialog(cellId?'Preview a substitution':previous?'Regenerate this challenge':'Plan an owned-game challenge');
    node.insertAdjacentHTML('beforeend',`<p>Choose games you already have access to. Boards shrink to fit your library; each game fills at most one cell. The same new finish can count toward different accepted challenge types.</p>
      <form data-generate><div class="challenge-fields"><label>Template<select name="templateId">${Object.entries(CHALLENGE_TEMPLATES).map(([id,template])=>`<option value="${id}"${(old?.rules.templateId??templateId)===id?' selected':''}>${esc(template.name)}</option>`).join('')}</select></label><label data-list-field><span data-list-label>List</span><select name="list"></select></label><label>System<select name="system"></select></label><label>Store<select name="store"></select></label></div>
      <p data-description></p><label class="history-check" data-replay><input name="allowReplays" type="checkbox"> Include finished games for a new replay</label>
      <div class="challenge-fields" data-dates><label>Season starts (optional)<input name="startOn" type="date"></label><label>Season ends (optional)<input name="endOn" type="date"></label></div>
      <p class="challenge-meta" data-dates-note>Leave both dates blank for an evergreen plan. Dated seasons require both a new finish date and its local recording date within the window. Milestones show progress but do not fill a cell.</p><button type="submit" data-generate-button>${previous?'Preview regeneration':'Preview matching games'}</button></form>
      <div data-challenge-preview></div><p data-challenge-status role="status"></p>`);
    const form=node.querySelector('[data-generate]'),status=node.querySelector('[data-challenge-status]'),previewHost=node.querySelector('[data-challenge-preview]');
    // Systems and stores you own games on, A–Z with how many games each offers for this
    // template; the ones it can't use are disabled.
    // The series or timelines a list template can use, with how many owned games fit each.
    function fillLists() {
      const templateId=form.elements.templateId.value,select=form.elements.list,lists=challengeLists(templateId),field=node.querySelector('[data-list-field]');
      field.hidden=!lists;select.disabled=!lists;if(!lists){select.innerHTML='';return;}
      node.querySelector('[data-list-label]').textContent=CHALLENGE_TEMPLATES[templateId].list==='series'?'Series':'Genre history';
      const current=select.value,counts=client.challengeListCounts(templateId).sort((a,b)=>Number(!a.count)-Number(!b.count)||b.count-a.count||a.name.localeCompare(b.name));
      select.innerHTML=counts.map(item=>`<option value="${esc(item.id)}"${item.count?'':' disabled'}>${esc(capital(item.name))} (${item.count} owned)</option>`).join('');
      select.value=counts.some(item=>item.id===current&&item.count)?current:counts.find(item=>item.count)?.id??'';
    }
    function fillFacets() {
      const {templateId:{value:templateId},system,store,list}=form.elements;
      const facets=client.challengeFacets({templateId,system:system.value,store:store.value,list:list.disabled?'':list.value});
      const fill=(select,items,label,all,total)=>{
        const current=select.value;
        select.innerHTML=`<option value="">${esc(all)} (${total})</option>${items.map(item=>({...item,name:label(item.id)})).sort(byName).map(item=>`<option value="${esc(item.id)}"${item.count?'':' disabled'}>${esc(item.name)} (${item.count})</option>`).join('')}`;
        const chosen=items.find(item=>item.id===current);
        select.value=chosen?.count?current:'';
        return chosen&&!chosen.count?label(current):null;
      };
      const lostSystem=fill(system,facets.systems,systemName,'All systems',facets.anySystem),lostStore=fill(store,facets.stores,id=>id,'Any store',facets.anyStore);
      if(lostSystem||lostStore)status.textContent=`${lostSystem??lostStore} has no games for this template, so the filter was cleared.`;
    }
    if(old){form.elements.allowReplays.checked=old.rules.allowReplays;form.elements.startOn.value=old.rules.startOn??'';form.elements.endOn.value=old.rules.endOn??'';form.elements.templateId.disabled=true;}
    fillLists();if(old?.rules.list){form.elements.list.value=old.rules.list;form.elements.list.disabled=true;}
    fillFacets();if(old){form.elements.system.value=old.rules.system;form.elements.store.value=old.rules.store??'';fillFacets();}
    function typeChanged() {
      const type=form.elements.templateId.value;node.querySelector('[data-description]').textContent=CHALLENGE_TEMPLATES[type].description;
      node.querySelector('[data-replay]').hidden=type!=='rediscovery';form.elements.allowReplays.disabled=type!=='rediscovery';
      node.querySelector('[data-dates]').hidden=node.querySelector('[data-dates-note]').hidden=type!=='season';form.elements.startOn.disabled=form.elements.endOn.disabled=type!=='season';
      preview=null;previewHost.replaceChildren();
    }
    typeChanged();form.onchange=event=>{status.textContent='';if(event.target.name==='templateId')fillLists();if(['templateId','list','system','store'].includes(event.target.name))fillFacets();typeChanged();};
    // A cell's choices: each game once (its best copy first), never one already on the board.
    function candidatesFor(cell) {
      const fits=member=>{
        if(preview.rules.templateId==='passport'&&member.platform!==cell.category)return false;
        if(preview.rules.templateId==='decades'&&(member.year===null||String(Math.floor(member.year/10)*10)!==cell.category))return false;
        if(preview.rules.templateId==='bingo'&&!member.genres.includes(cell.category))return false;
        return !preview.cells.some(other=>other.id!==cell.id&&sameGame(member,other.member));
      };
      // The current choice comes first, so it is the copy kept for its game.
      return distinctChallengeGames(client.snapshot(),[cell.member,...preview.candidates.filter(member=>member.key!==cell.member.key&&fits(member))],{perSystem:preview.rules.templateId==='passport'});
    }
    function renderPreview() {
      sameGame=challengeIdentity(client.snapshot());
      const count=preview.cells.length,rewards=showRewards(),bonus=preview.bonus;
      previewHost.innerHTML=`<h3>${count} / ${preview.requestedSize} matching slots${count<preview.requestedSize?' · smaller board':''}</h3>${count?`<p>${cellId?'Unchanged cells keep their progress. The replacement starts counting after confirmation.':previous?'Regeneration starts new cell boundaries. Earlier revisions and earned badges stay in history.':'Acceptance keeps a snapshot of these copies, metadata and rules.'} ${rewards?`${bonus} XP bonus with progress rewards enabled before completion. One current bonus per challenge; revisions do not stack bonuses.`:''}</p>`:'<p>No achievable board in these filters. Try another template or system, or import games you own. No purchase is required.</p>'}
        <div class="challenge-preview-cells">${preview.cells.map(cell=>{
          const editable=!cellId||cellId===cell.id,options=editable?candidatesFor(cell):[];
          if(editable&&!options.some(member=>member.key===cell.member.key))options.unshift(cell.member);
          return `<article><h4>${esc(categoryName(preview.rules,cell.category))}</h4>${editable?`<label>Selected copy<select data-cell="${cell.id}">${options.map(member=>`<option value="${esc(member.key)}"${member.key===cell.member.key?' selected':''}>${esc(member.title)} · ${esc(systemName(member.platform))} · ${esc(member.descriptor.ref.provider)}</option>`).join('')}</select></label>`:`<p>${esc(cell.member.title)}</p>`}${memberCopy(cell.member)}</article>`;
        }).join('')}</div><p class="challenge-meta">${esc(preview.rules.timeZone)} · ${preview.rules.startOn?`${preview.rules.startOn} through ${preview.rules.endOn}`:'Evergreen · no deadline'}. Editorial ranks compare games within one system. Current metadata match hints need your review.</p>
        ${count?'<form data-accept><label class="history-check"><input name="confirmed" type="checkbox" required> I have access to these copies and have checked the edition, platform and metadata matches.</label><button type="submit">Confirm challenge</button></form>':''}`;
      previewHost.querySelectorAll('[data-cell]').forEach(select=>select.onchange=()=>{try{preview=chooseChallengeMember(client.snapshot(),preview,select.dataset.cell,select.value);renderPreview();status.textContent='Selection updated. Review it before confirming.';}catch(error){status.textContent=error.message;}});
      previewHost.querySelector('[data-accept]')?.addEventListener('submit',async event=>{
        event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
        try {
          if(cellId&&preview.cells.every(cell=>old.cells.some(prior=>prior.id===cell.id&&prior.member.key===cell.member.key)))throw Error('Choose a different matching copy before substituting.');
          const result=await client.acceptChallenge(preview,{confirmed:event.target.elements.confirmed.checked,previousId,reason:cellId?'substitution':previous?'regenerated':'accepted'});
          if(result.saved)node.close();else status.textContent='Session only — export a tracking backup before leaving.';
        }catch(error){status.textContent=error.message;button.disabled=false;}
      });
    }
    form.onsubmit=event=>{event.preventDefault();try{preview=client.previewChallenge({templateId:form.elements.templateId.value,...(challengeLists(form.elements.templateId.value)?{list:form.elements.list.value}:{}),system:form.elements.system.value,store:form.elements.store.value,allowReplays:!form.elements.allowReplays.disabled&&form.elements.allowReplays.checked,startOn:form.elements.startOn.disabled?null:form.elements.startOn.value,endOn:form.elements.endOn.disabled?null:form.elements.endOn.value});status.textContent='';renderPreview();}catch(error){status.textContent=error.message;}};
    if(cellId){form.hidden=true;try{preview=client.previewSubstitution(previousId,cellId);renderPreview();}catch(error){status.textContent=error.message;}}
    node.showModal();
  }
  function historyDialog(id) {
    const state=client.snapshot(),instance=state.challenges[id],node=dialog(`${boardName(state.challengeRevisions[instance.currentRevision].rules)} · Revision history`);
    const revisions=Object.values(state.challengeRevisions).filter(revision=>revision.challengeId===id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    node.insertAdjacentHTML('beforeend',revisions.map(revision=>{
      const progress=challengeProgress(state,revision),awards=Object.values(state.challengeAwards).filter(award=>award.revisionId===revision.id);
      return `<article class="challenge-revision"><h3>${esc(revision.reason)} · ${esc(new Date(revision.createdAt).toLocaleString())}</h3><p>${progress.finished}/${progress.total} currently valid finishes${revision.id===instance.currentRevision?' · Current revision':''}</p><ul>${revision.cells.map(cell=>`<li>${esc(categoryName(revision.rules,cell.category))}: ${esc(cell.member.title)} (${esc(systemName(cell.member.platform))})${cell.member.rank?` · accepted rank #${cell.member.rank.position} (catalog ${esc(cell.basis.catalogUpdatedAt)})`:''}</li>`).join('')}</ul><p class="challenge-meta">Ranking: ${esc(revision.basis.mode)} v${revision.basis.methodVersion} · catalog ${esc(revision.basis.catalogUpdatedAt)} · snapshot ${esc(revision.basis.snapshot)}</p>${showRewards()?awards.map(award=>`<p class="challenge-badge">${validChallengeAward(state,award)?'Badge earned':'Badge corrected — supporting finish changed'} · ${esc(new Date(award.at).toLocaleString())}${award.rewardEligible?` · ${revision.bonus} XP when valid`:' · recorded before XP was enabled'}</p>`).join(''):''}</article>`;
    }).join(''));node.showModal();
  }
  function accessible(member) {
    if(member.descriptor.ref.provider!=='playnite')return true;
    return client.library.some(game=>game.copies.some(copy=>copy.id===member.descriptor.ref.id&&copy.available!==false));
  }
  function render() {
    const state=client.snapshot(),showArchived=host.querySelector('[data-archived]')?.open??false,rewards=state.settings.gamificationVisible;
    const active=Object.values(state.challenges).filter(instance=>!instance.archived),archived=Object.values(state.challenges).filter(instance=>instance.archived);
    function card(instance) {
      const revision=state.challengeRevisions[instance.currentRevision],progress=challengeProgress(state,revision);
      const awards=Object.values(state.challengeAwards).filter(award=>award.challengeId===instance.id),earned=awards.find(award=>validChallengeAward(state,award));
      return `<article class="challenge-card" data-challenge="${esc(instance.id)}"><header><div><p class="eyebrow">${instance.archived?'Archived plan':'Your owned games'}</p><h3>${esc(boardName(revision.rules))}</h3></div><span class="challenge-count">${progress.finished} / ${progress.total} finished</span></header><p>${revision.rules.startOn?`${revision.rules.startOn} through ${revision.rules.endOn} · ${esc(revision.rules.timeZone)}`:'Evergreen · your own pace'}${revision.rules.allowReplays?' · New replays allowed':''}</p>
        ${rewards?`<p class="challenge-badge">${earned?`${earned.revisionId===revision.id?'Badge earned':'Earlier revision badge earned'}${earned.rewardEligible?` · ${state.challengeRevisions[earned.revisionId].bonus} XP`:' · recorded while XP was off'}`:awards.length?'Earlier badge corrected; its history is retained.':instance.archived?'Archived · no new badges':`${revision.bonus} XP bonus${state.progression.profile?'':' if rewards are enabled before completion'}`}</p>`:''}
        <div class="challenge-cells">${revision.cells.map(cell=>{
          const status=progress.cells.find(item=>item.id===cell.id),available=accessible(cell.member);
          return `<section class="challenge-cell${status.done?' is-done':''}"><p class="eyebrow">${esc(categoryName(revision.rules,cell.category))}</p><h4>${esc(cell.member.title)}</h4><p class="challenge-meta">${esc(systemName(cell.member.platform))}${cell.member.rank?` · accepted list #${cell.member.rank.position}`:''}</p><p class="challenge-cell-status">${status.done?'Finished':status.milestones?`${status.milestones} achieved milestone${status.milestones===1?'':'s'}`:'Ready when you are'}</p><p class="challenge-meta">${esc(status.explanation)}</p>${!available?'<p class="challenge-meta">This copy is missing or unavailable in the current import. Saved progress is retained; you can choose a substitution.</p>':''}<div class="tracking-actions"><button type="button" data-track="${esc(instance.id)}" data-cell="${cell.id}">Track selected copy</button>${!instance.archived?`<button type="button" data-substitute="${esc(instance.id)}" data-cell="${cell.id}">Substitute</button>`:''}</div></section>`;
        }).join('')}</div><div class="tracking-actions"><button type="button" data-challenge-history="${esc(instance.id)}">Rules &amp; revision history</button>${!instance.archived?`<button type="button" data-regenerate="${esc(instance.id)}">Preview regeneration</button><button type="button" data-archive="${esc(instance.id)}">Archive plan</button>`:''}</div></article>`;
    }
    host.innerHTML=`<header><p class="eyebrow">Explore what you already own</p><h2 id="challengesTitle">Challenges &amp; seasons</h2><p>Small themed plans with a fixed set of games. One copy per cell, progress at your pace.</p><button id="newChallenge" type="button">Plan a challenge</button></header>${active.map(card).join('')||'<p class="challenge-empty">Choose a console passport, decade tour, owned top ten, genre bingo, rediscovery or a personal season. Small libraries get smaller boards.</p>'}<details data-archived${showArchived?' open':''}><summary>Archived plans (${archived.length})</summary>${archived.map(card).join('')||'<p>No archived plans yet.</p>'}</details>`;
    host.querySelector('#newChallenge').onclick=()=>previewEditor();
    host.querySelectorAll('[data-track]').forEach(button=>button.onclick=()=>{const instance=state.challenges[button.dataset.track],cell=state.challengeRevisions[instance.currentRevision].cells.find(cell=>cell.id===button.dataset.cell);openTarget(cell.member.targetId,[cell.member.descriptor]);});
    host.querySelectorAll('[data-substitute]').forEach(button=>button.onclick=()=>previewEditor({previousId:button.dataset.substitute,cellId:button.dataset.cell}));
    host.querySelectorAll('[data-regenerate]').forEach(button=>button.onclick=()=>previewEditor({previousId:button.dataset.regenerate}));
    host.querySelectorAll('[data-challenge-history]').forEach(button=>button.onclick=()=>historyDialog(button.dataset.challengeHistory));
    host.querySelectorAll('[data-archive]').forEach(button=>button.onclick=()=>client.run(()=>client.archiveChallenge(button.dataset.archive,state.challenges[button.dataset.archive])));
  }
  return {render};
}
