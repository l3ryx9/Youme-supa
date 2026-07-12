// FIX : converti depuis app.json (statique) vers app.config.js (dynamique)
// pour pouvoir injecter la clé Google Maps Android depuis une variable
// d'environnement au moment de la construction, au lieu de la coder en dur.
// GOOGLE_MAPS_API_KEY_ANDROID doit être définie dans l'environnement (ou dans
// eas.json -> build.<profile>.env pour les builds EAS, qui ne voient pas les
// secrets Replit/locaux).
module.exports = {
  expo: {
    name: 'YouMe',
    slug: 'youme',
    owner: 'alemille',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/logo-icon.jpg',
    userInterfaceStyle: 'dark',
    scheme: 'youme',
    splash: {
      image: './assets/images/logo-splash.png',
      resizeMode: 'contain',
      backgroundColor: '#000000',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.youme24.appname',
      buildNumber: '1',
      infoPlist: {
        NSMicrophoneUsageDescription:
          "YouMe Intelligente nécessite l'accès au microphone pour enregistrer des messages vocaux.",
        NSPhotoLibraryUsageDescription:
          "YouMe Intelligente nécessite l'accès à la galerie pour partager des photos.",
        NSPhotoLibraryAddUsageDescription:
          "YouMe Intelligente nécessite l'accès à la galerie pour partager des photos.",
        NSCameraUsageDescription:
          "YouMe Intelligente nécessite l'accès à la caméra pour prendre des photos et vidéos.",
        NSUserNotificationsUsageDescription:
          'YouMe Intelligente nécessite les notifications pour vous alerter des nouveaux messages.',
        NSLocationWhenInUseUsageDescription:
          "YouMe Intelligente nécessite l'accès à la position pour le partage de position en direct.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "YouMe Intelligente nécessite l'accès à la position en arrière-plan pour continuer le partage de position quand l'écran est verrouillé.",
        UIBackgroundModes: ['location'],
      },
      googleServicesFile: './GoogleService-Info.plist',
    },
    android: {
      package: 'com.youme24.appname',
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: './assets/images/logo-icon.jpg',
        backgroundColor: '#000000',
      },
      // FIX : react-native-maps a besoin de cette clé pour afficher les
      // tuiles Google Maps sur Android. Sans elle, la mini-carte de position
      // reste vide/grise. iOS utilise Apple Maps par défaut (pas de clé requise).
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY_ANDROID,
        },
      },
      permissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_AUDIO',
        'android.permission.CAMERA',
        'android.permission.VIBRATE',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
      ],
      googleServicesFile: './google-services.json',
    },
    web: {
      bundler: 'metro',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-notifications',
      [
        'expo-av',
        {
          microphonePermission:
            "Autoriser YouMe à accéder au microphone pour enregistrer des messages vocaux.",
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission:
            "YouMe Intelligente nécessite l'accès à la galerie pour partager des photos et vidéos.",
          cameraPermission:
            "YouMe Intelligente nécessite l'accès à la caméra pour prendre des photos et vidéos.",
        },
      ],
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            "YouMe Intelligente nécessite l'accès à la position en arrière-plan pour continuer le partage de position quand l'écran est verrouillé.",
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      '@react-native-firebase/app',
      [
        'expo-build-properties',
        {
          android: {
            minSdkVersion: 24,
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            extraProguardRules:
              '-keep class org.tensorflow.** { *; }\n-dontwarn org.tensorflow.**\n-keep class com.google.flatbuffers.** { *; }\n-dontwarn com.google.flatbuffers.**',
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {
        origin: false,
      },
      eas: {
        projectId: '418495b0-a4e0-4481-8fc3-7f4f620f6dcb',
      },
    },
    description: 'YouMe Intelligente — Application de messagerie privée avec IA locale',
    sdkVersion: '51.0.0',
    platforms: ['ios', 'android'],
    jsEngine: 'hermes',
  },
};
