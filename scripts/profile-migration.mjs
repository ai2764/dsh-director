import YAML from 'yaml';

// Plan only: the caller backs up the profile before applying these texts.
export function planProfileMigration({ packageText, patchText }) {
  const pkg = JSON.parse(packageText);
  const profile = pkg.dsh?.profile;
  if (!profile || !Array.isArray(profile.bundles)) throw new Error('Unknown profile bundle structure');
  if (!profile.bundles.includes('dsh-director')) profile.bundles.push('dsh-director');
  const doc = YAML.parseDocument(patchText);
  if (doc.errors.length || !YAML.isSeq(doc.contents)) throw new Error('Unknown profile patch structure');
  for (let i = doc.contents.items.length - 1; i >= 0; i--) {
    const row = doc.contents.items[i];
    const inserted = row?.get?.('insert', true);
    if (!YAML.isSeq(inserted)) continue;
    for (let j = inserted.items.length - 1; j >= 0; j--) {
      const entry = inserted.items[j];
      if (entry?.get?.('id') !== 'submit-comfy-video') continue;
      if (entry.get('name') !== './plugins/submit-comfy-video-h3-reviewed.mjs') throw new Error('Unknown submit-comfy-video owner; refusing migration');
      inserted.items.splice(j, 1);
    }
    if (!inserted.items.length) doc.contents.items.splice(i, 1);
  }
  return { packageText: JSON.stringify(pkg, null, 2) + '\n', patchText: doc.toString() };
}
