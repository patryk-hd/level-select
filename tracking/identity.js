// Shared, explicitly confirmed identity groups; titles never merge progress.
export function rewardGroups(state) {
  const parent = new Map(Object.keys(state.targets).map(id=>[id,id]));
  const root = id => { const next = parent.get(id); if (next && next !== id) parent.set(id,root(next)); return parent.get(id) ?? id; };
  for (const link of Object.values(state.rewardLinks)) if (link.active) {
    const ids = link.targetIds.map(root).sort(); parent.set(ids[1],ids[0]);
  }
  return new Map([...parent.keys()].map(id=>[id,root(id)]));
}
