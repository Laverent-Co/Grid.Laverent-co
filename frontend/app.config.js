// Dynamic Expo config — adds the Base44 preview origin to Expo's CORS allowlist.
// Without this, Expo's dev server rejects cross-origin requests from the preview iframe.
const baseConfig = require('./app.json');

export default ({ config }) => ({
  ...config,
  expo: {
    ...config.expo,
    extra: {
      ...(config.expo?.extra || {}),
      router: {
        ...((config.expo?.extra || {}).router || {}),
        origin: process.env.EXPO_ROUTER_ORIGIN || undefined,
      },
    },
  },
});
