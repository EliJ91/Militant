export const ITEM_TYPE_OPTIONS = [
  { label: 'Weapons', value: 'weapon' },
  { label: 'Off Hands', value: 'offhand' },
  { label: 'Head Pieces', value: 'head' },
  { label: 'Armor', value: 'armor' },
  { label: 'Shoes', value: 'shoes' },
  { label: 'Bags', value: 'bag' },
  { label: 'Capes', value: 'cape' },
  { label: 'Food', value: 'food' },
  { label: 'Potions', value: 'potion' },
  { label: 'Mounts', value: 'mount' },
  { label: 'Mementos', value: 'memento' },
  { label: 'Tools', value: 'tool' },
  { label: 'Resources', value: 'resource' },
  { label: 'Artifacts', value: 'artifact' },
  { label: 'Furniture', value: 'furniture' },
  { label: 'Trash', value: 'trash' },
  { label: 'Other', value: 'other' },
];

function normalizedText(row) {
  return `${row?.itemId || ''} ${row?.item || row?.itemName || ''}`.toLowerCase();
}

export function getItemType(row) {
  const text = normalizedText(row);
  const itemId = String(row?.itemId || '').toUpperCase();
  const itemName = String(row?.item || row?.itemName || '').toLowerCase();

  if (/\bskin\b|\bsiege hammer\b/.test(itemName)) return 'other';
  if (text.includes('trash')) return 'trash';
  if (text.includes('memento')) return 'memento';
  if (itemId.includes('_BAG') || /\bbag\b/.test(text)) return 'bag';
  if (itemId.includes('_CAPE') || /\bcape\b/.test(text)) return 'cape';
  if (text.includes('potion') || text.includes('poison')) return 'potion';
  if (
    /meal|food|omelette|stew|sandwich|pie|salad|soup|fish|roast|goose|pork|beef|mutton|chicken/.test(text)
  ) return 'food';
  if (
    itemId.includes('MOUNT')
    || /mount|horse|ox|stag|swiftclaw|wolf|boar|bear|mare|panther|lizard|moose|mammoth|ram|cougar|basilisk|salamander|terrorbird|chariot/.test(text)
  ) return 'mount';
  if (/^T\d+_HEAD_/.test(itemId) || /\b(helmet|helm|hood|cowl|hat|cap|mask)\b/.test(text)) return 'head';
  if (/^T\d+_ARMOR_/.test(itemId) || /\b(armor|armour|jacket|robe|garb|chestpiece)\b/.test(text)) return 'armor';
  if (/^T\d+_SHOES_/.test(itemId) || /\b(boots|shoes|sandals)\b/.test(text)) return 'shoes';
  if (/^T\d+_OFF_/.test(itemId) || /\b(shield|aegis|book|tome|orb|torch|horn|totem|censor|censer|mistcaller)\b/.test(text)) return 'offhand';
  if (/^T\d+_(2H|MAIN)_/.test(itemId)) return 'weapon';
  if (/^T\d+_TOOL_/.test(itemId) || /\b(pickaxe|axe|sickle|knife|skinning|stone hammer|demolition hammer)\b/.test(text)) return 'tool';
  if (itemId.includes('FURNITURE') || /\b(furniture|banner|table|bed|chest|decoration|statue|repair kit)\b/.test(text)) return 'furniture';
  if (/\b(hide|ore|wood|logs|rock|stone|fiber|cloth|leather|bar|plank|block|resource)\b/.test(text)) return 'resource';
  if (/\b(rune|soul|relic|artifact|shard|crystal)\b/.test(text)) return 'artifact';
  if (
    /\b(staff|bow|sword|axe|mace|hammer|spear|dagger|crossbow|fire|frost|arcane|cursed|curse|nature|holy|quarterstaff|blade|scythe|pair|gauntlets|bracers)\b/.test(text)
  ) return 'weapon';

  return 'other';
}
