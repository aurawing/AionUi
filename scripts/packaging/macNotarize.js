/**
 * macOS notarization / staple helpers for pack-mac.sh and afterSign.js.
 */

function resolveAppleNotaryEnv(env = {}) {
  return {
    appleId: String(env.appleId || env.APPLE_ID || '').trim(),
    appleIdPassword: String(env.appleIdPassword || env.APPLE_ID_PASSWORD || '').trim(),
    teamId: String(env.teamId || env.APPLE_TEAM_ID || env.TEAM_ID || '').trim(),
  };
}

function hasNotaryCredentials(env = {}) {
  const { appleId, appleIdPassword, teamId } = resolveAppleNotaryEnv(env);
  return Boolean(appleId && appleIdPassword && teamId);
}

function isDeveloperIdSigned(codesignDvOutput) {
  const text = String(codesignDvOutput || '');
  if (/Signature=adhoc/i.test(text)) {
    return false;
  }
  return /Authority=Developer ID Application:/i.test(text);
}

function missingNotaryCredentialMessage(env = {}) {
  const creds = resolveAppleNotaryEnv(env);
  const missing = [];
  if (!creds.appleId) missing.push('appleId / APPLE_ID');
  if (!creds.appleIdPassword) missing.push('appleIdPassword / APPLE_ID_PASSWORD');
  if (!creds.teamId) missing.push('teamId / TEAM_ID');
  if (missing.length === 0) {
    return '';
  }
  return `Missing notarization credentials: ${missing.join(', ')}.`;
}

function listMacDmgFiles(fileNames) {
  return (Array.isArray(fileNames) ? fileNames : [])
    .filter((name) => /^AionUi-.+-mac-.+\.dmg$/i.test(String(name || '')))
    .sort();
}

function notarytoolSubmitArgs({ dmgPath, appleId, appleIdPassword, teamId }) {
  if (!dmgPath) {
    throw new Error('dmgPath is required to submit for notarization.');
  }
  if (!appleId || !appleIdPassword || !teamId) {
    throw new Error('appleId, appleIdPassword, and teamId are required to notarize the dmg.');
  }
  return [
    'xcrun',
    'notarytool',
    'submit',
    dmgPath,
    '--apple-id',
    appleId,
    '--password',
    appleIdPassword,
    '--team-id',
    teamId,
    '--wait',
  ];
}

function staplerStapleArgs(filePath) {
  if (!filePath) {
    throw new Error('filePath is required to staple.');
  }
  return ['xcrun', 'stapler', 'staple', filePath];
}

function staplerValidateArgs(filePath) {
  if (!filePath) {
    throw new Error('filePath is required to validate a staple.');
  }
  return ['xcrun', 'stapler', 'validate', filePath];
}

function spctlDmgAssessArgs(dmgPath) {
  if (!dmgPath) {
    throw new Error('dmgPath is required for spctl assessment.');
  }
  return ['spctl', '--assess', '--verbose=4', '--type', 'open', '--context', 'context:primary-signature', dmgPath];
}

module.exports = {
  hasNotaryCredentials,
  isDeveloperIdSigned,
  listMacDmgFiles,
  missingNotaryCredentialMessage,
  notarytoolSubmitArgs,
  resolveAppleNotaryEnv,
  spctlDmgAssessArgs,
  staplerStapleArgs,
  staplerValidateArgs,
};
