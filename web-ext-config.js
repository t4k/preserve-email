// This configuration file provides signing details to the web-ext tool.
// It's a more robust method than command-line flags for CI environments.

module.exports = {
  sign: {
    apiKey: process.env.WEB_EXT_API_KEY,
    apiSecret: process.env.WEB_EXT_API_SECRET,
    amoBaseUrl: 'https://addons.thunderbird.net/api/v5',
    channel: 'listed',
  },
};