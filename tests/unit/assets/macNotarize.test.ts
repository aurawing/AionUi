import { describe, expect, it } from 'vitest';

const kit = require('../../../scripts/packaging/macNotarize');

describe('mac dmg notarization helpers', () => {
  it('maps APPLE_ID aliases into the afterSign env names', () => {
    expect(
      kit.resolveAppleNotaryEnv({
        APPLE_ID: 'dev@example.com',
        APPLE_ID_PASSWORD: 'xxxx-xxxx-xxxx-xxxx',
        TEAM_ID: '4295LWG5D8',
      })
    ).toEqual({
      appleId: 'dev@example.com',
      appleIdPassword: 'xxxx-xxxx-xxxx-xxxx',
      teamId: '4295LWG5D8',
    });
  });

  it('rejects ad-hoc codesign output as Developer ID', () => {
    expect(kit.isDeveloperIdSigned('Executable=/AionUi.app/Contents/MacOS/AionUi\nSignature=adhoc\n')).toBe(false);
  });

  it('accepts Developer ID Application authority lines', () => {
    expect(
      kit.isDeveloperIdSigned(
        'Authority=Developer ID Application: Tianjin Shuyuan Technology Co.,Ltd. (4295LWG5D8)\nTeamIdentifier=4295LWG5D8\n'
      )
    ).toBe(true);
  });

  it('lists missing notarization credential names', () => {
    expect(kit.missingNotaryCredentialMessage({ appleId: 'a@b.c' })).toContain('appleIdPassword');
    expect(kit.missingNotaryCredentialMessage({ appleId: 'a@b.c' })).toContain('teamId');
    expect(
      kit.missingNotaryCredentialMessage({
        appleId: 'a@b.c',
        appleIdPassword: 'x',
        teamId: '4295LWG5D8',
      })
    ).toBe('');
  });

  it('refuses to build a notarytool command without the dmg path', () => {
    expect(() =>
      kit.notarytoolSubmitArgs({
        appleId: 'a@b.c',
        appleIdPassword: 'x',
        teamId: '4295LWG5D8',
      })
    ).toThrow(/dmgPath is required/);
  });

  it('builds notarytool submit --wait for the dmg', () => {
    expect(
      kit.notarytoolSubmitArgs({
        dmgPath: '/out/AionUi-2.2.2-mac-arm64.dmg',
        appleId: 'a@b.c',
        appleIdPassword: 'secret',
        teamId: '4295LWG5D8',
      })
    ).toEqual([
      'xcrun',
      'notarytool',
      'submit',
      '/out/AionUi-2.2.2-mac-arm64.dmg',
      '--apple-id',
      'a@b.c',
      '--password',
      'secret',
      '--team-id',
      '4295LWG5D8',
      '--wait',
    ]);
  });

  it('selects only AionUi mac dmg artifacts', () => {
    expect(
      kit.listMacDmgFiles(['AionUi-2.2.2-mac-arm64.dmg', 'AionUi-2.2.2-win-x64.exe', 'builder-debug.yml'])
    ).toEqual(['AionUi-2.2.2-mac-arm64.dmg']);
  });
});
