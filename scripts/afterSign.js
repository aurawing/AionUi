const { execSync } = require('child_process');
const {
  hasNotaryCredentials,
  isDeveloperIdSigned,
  missingNotaryCredentialMessage,
  resolveAppleNotaryEnv,
} = require('./packaging/macNotarize');

function captureCodesignDetails(appPath) {
  try {
    return execSync(`codesign -dv --verbose=2 "${appPath}" 2>&1`, { encoding: 'utf8' });
  } catch (error) {
    return `${error.stdout || ''}${error.stderr || ''}${error.message || ''}`;
  }
}

function staple(appPath) {
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
  execSync(`xcrun stapler validate "${appPath}"`, { stdio: 'inherit' });
}

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appBundleId = context.packager.appInfo.id;
  const appPath = `${appOutDir}/${appName}.app`;
  const details = captureCodesignDetails(appPath);
  const developerId = isDeveloperIdSigned(details);

  if (!developerId) {
    if (hasNotaryCredentials(process.env)) {
      throw new Error(
        `${appName} is not signed with Developer ID Application; refusing notarization. Set CSC_NAME to the company name and Team ID (no "Developer ID Application:" prefix). codesign -dv output:\n${details}`
      );
    }
    console.log(`App ${appName} is not Developer ID signed, applying ad-hoc signature...`);
    try {
      execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
      console.log(`Ad-hoc signature applied successfully to ${appName}`);
    } catch (adHocError) {
      console.error('Ad-hoc signing failed:', adHocError.message);
    }
    return;
  }

  console.log(`App ${appName} is signed with Developer ID Application`);

  if (!hasNotaryCredentials(process.env)) {
    console.log(`Skipping notarization - ${missingNotaryCredentialMessage(process.env)}`);
    return;
  }

  const { notarize } = await import('@electron/notarize');
  const { appleId, appleIdPassword, teamId } = resolveAppleNotaryEnv(process.env);

  console.log(`Starting notarization for ${appName} (${appBundleId})...`);

  try {
    await notarize({
      tool: 'notarytool',
      appBundleId,
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('App notarization completed, stapling ticket...');
    staple(appPath);
    console.log(`Stapled notarization ticket onto ${appName}.app`);
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
