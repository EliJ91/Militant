import { describe, expect, it } from 'vitest';
import {
  normalizePermissionSettings,
  WEBAPP_PERMISSION_DEFINITIONS,
} from './permissionsService';

describe('permissions service', () => {
  it('replaces the legacy death-search permission with Add Death ID', () => {
    const settings = normalizePermissionSettings({
      roles: [{
        id: 'soldier',
        name: 'Soldier',
        permissions: { searchDeaths: true },
        roleId: '805910066346721341',
      }],
    });

    expect(WEBAPP_PERMISSION_DEFINITIONS).toContainEqual({
      area: 'Loot Logs',
      key: 'addDeathId',
      label: 'Add Death ID',
    });
    expect(WEBAPP_PERMISSION_DEFINITIONS.some(({ key }) => key === 'searchDeaths')).toBe(false);
    expect(WEBAPP_PERMISSION_DEFINITIONS).toContainEqual({
      area: 'Loot Logs',
      key: 'viewDeaths',
      label: 'View Deaths',
    });
    expect(WEBAPP_PERMISSION_DEFINITIONS).toContainEqual({
      area: 'Loot Logs',
      key: 'viewHiddenLootLogPlayers',
      label: 'View Hidden Players (Loot Log)',
    });
    expect(settings.roles[0].permissions.addDeathId).toBe(true);
    expect(settings.roles[0].permissions).not.toHaveProperty('searchDeaths');
  });

  it('keeps the loot and chest override permissions together in the Loot Logs section', () => {
    const overrideLootIndex = WEBAPP_PERMISSION_DEFINITIONS.findIndex(({ key }) => key === 'overrideLootLog');
    expect(WEBAPP_PERMISSION_DEFINITIONS.slice(overrideLootIndex, overrideLootIndex + 2)).toEqual([
      { area: 'Loot Logs', key: 'overrideLootLog', label: 'Override Loot Log' },
      { area: 'Loot Logs', key: 'overrideChestLog', label: 'Override Chest Log' },
    ]);
  });
});
