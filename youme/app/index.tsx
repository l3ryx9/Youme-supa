/**
 * Route d'entrée « / » — Expo Router
 *
 * Rôle : donner un écran correspondant à l'URL initiale « / » et rediriger
 * immédiatement vers le bon groupe de routes selon l'état d'authentification.
 *
 * Pourquoi ce fichier existe :
 *   Sans lui, « / » ne correspond à aucun écran (il n'y a que les groupes
 *   (auth) et (app)). L'app se retrouvait alors à naviguer « à la main »
 *   depuis le layout racine avant que le navigateur soit monté — ce qui
 *   fait planter l'app juste après l'intro. Ici, on utilise le composant
 *   <Redirect> d'Expo Router, qui attend que la navigation soit prête avant
 *   de rediriger : plus de crash, et le login/inscription s'affiche.
 *
 * L'intro animée « YouMe » reste gérée par app/_layout.tsx (overlay plein
 * écran) : cet écran peut donc ne rien rendre de visible (null).
 */
import { Redirect } from 'expo-router';
import { useAuthStore } from '@presentation/stores/authStore';

export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <Redirect href={isAuthenticated ? '/(app)/(tabs)' : '/(auth)/login'} />
  );
}
