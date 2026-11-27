import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { API_URL, MQTT_URL } from './src/config';
import { HomeScreen } from './src/HomeScreen';
import { usePieceApi } from './src/usePieceApi';
import { usePieceFactice } from './src/usePieceFactice';
import { usePieceMqtt } from './src/usePieceMqtt';

// Source des données selon mobile/.env, choisie une fois au démarrage :
// broker MQTT (mesures, état et commandes), sinon API (mesures seules), sinon démo.
const usePiece = MQTT_URL ? usePieceMqtt : API_URL ? usePieceApi : usePieceFactice;

export default function App() {
  const piece = usePiece();

  return (
    <SafeAreaProvider>
      <HomeScreen piece={piece} />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
