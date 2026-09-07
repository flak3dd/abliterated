/**
 * electron-builder afterSign hook — notarize macOS builds with notarytool.
 * Skips when Apple credentials are not present in the environment.
 *
 * Auth options (either):
 *   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
 *   APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
 *     (APPLE_API_KEY = path to .p8, or set APPLE_API_KEY_PATH)
 */
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  const appleApiKey =
    process.env.APPLE_API_KEY_PATH || process.env.APPLE_API_KEY;
  const appleApiKeyId = process.env.APPLE_API_KEY_ID;
  const appleApiIssuer = process.env.APPLE_API_ISSUER;

  const hasAppleIdAuth = Boolean(appleId && appleIdPassword && teamId);
  const hasApiKeyAuth = Boolean(appleApiKey && appleApiKeyId && appleApiIssuer);

  if (!hasAppleIdAuth && !hasApiKeyAuth) {
    console.log(
      'Skipping notarization: set APPLE_ID+APPLE_APP_SPECIFIC_PASSWORD+APPLE_TEAM_ID or APPLE_API_KEY(+_PATH)+APPLE_API_KEY_ID+APPLE_API_ISSUER'
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath} with notarytool…`);

  const options = {
    tool: 'notarytool',
    appPath,
  };

  if (hasApiKeyAuth) {
    options.appleApiKey = appleApiKey;
    options.appleApiKeyId = appleApiKeyId;
    options.appleApiIssuer = appleApiIssuer;
  } else {
    options.appleId = appleId;
    options.appleIdPassword = appleIdPassword;
    options.teamId = teamId;
  }

  await notarize(options);
  console.log('Notarization complete.');
};
